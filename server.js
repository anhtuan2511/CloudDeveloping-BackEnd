require("dotenv").config();
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const express = require("express");
const app = express();
const cors = require("cors");
const bodyParser = require("body-parser");
const moment = require("moment");
const port = 5000;

const [monthly, annually] = [
  "price_1OOht1GTp9a3NRWgCe1SMG4B",
  "price_1OOhuuGTp9a3NRWgyhp68cpk",
];
const stripe_key = process.env.STRIPE_SECRET_KEY;
const stripe = require("stripe")(stripe_key);

app.use(express.json());
app.use(bodyParser.json());

// For local env
// app.use(
//   cors({
//     origin: "http://localhost:5173",
//   })
// );

// For deploying
var whitelist = ['http://clouddev-subscription-frontend.s3-website-us-east-1.amazonaws.com', 'http://d2xdnqd5vgjxui.cloudfront.net/'];
var corsOptions = function (req, callback) {
   var corsOptions;
   if (whitelist.indexOf(req.header('Origin')) !== -1) {
       corsOptions = { origin: true }; // reflect (enable) the requested origin in the CORS response
   } else {
       corsOptions = { origin: false }; // disable CORS for this request
   }
   callback(null, corsOptions); // callback expects two parameters: error and options
};

app.use(cors(corsOptions));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://s3818169-clouddev-project-default-rtdb.asia-southeast1.firebasedatabase.app",
});

app.get("/test", function (req, res) {
  res.json({
    status: "OK",
  });
});

// Create Stripe payment
const stripeSession = async (plan) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      allow_promotion_codes: true,
      line_items: [
        {
          price: plan,
          quantity: 1,
        },
      ],
      success_url: "http://d2xdnqd5vgjxui.cloudfront.net/success",
      cancel_url: "http://d2xdnqd5vgjxui.cloudfront.net/failed",
    });
    return session;
  } catch (e) {
    return e;
  }
};

app.post("/api/v1/create-subscription-checkout-session", async (req, res) => {
  const { plan, customerId } = req.body;
  let planId = null;
  if (plan == 50) planId = monthly;
  else if (plan == 480) planId = annually;

  try {
    const session = await stripeSession(planId);
    const user = await admin.auth().getUser(customerId);

    await admin
      .database()
      .ref("users")
      .child(user.uid)
      .child("subscription")
      .update({
        sessionId: session.id,
      });
    console.log(session);
    return res.json({ session });
  } catch (error) {
    res.send(error);
  }
});

// Handling success payment
app.post("/api/v1/payment-success", async (req, res) => {
  const { sessionId, firebaseId } = req.body;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      const subscriptionId = session.subscription;
      try {
        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId
        );
        const user = await admin.auth().getUser(firebaseId);
        const planId = subscription.plan.id;
        const planType =
          subscription.plan.amount === 5000 ? "monthly" : "annually";
        const startDate = moment
          .unix(subscription.current_period_start)
          .format("YYYY-MM-DD");
        const endDate = moment
          .unix(subscription.current_period_end)
          .format("YYYY-MM-DD");
        const durationInSeconds =
          subscription.current_period_end - subscription.current_period_start;
        const durationInDays = moment
          .duration(durationInSeconds, "seconds")
          .asDays();
        await admin
          .database()
          .ref("users")
          .child(user.uid)
          .update({
            subscription: {
              sessionId: null,
              planId: planId,
              planType: planType,
              planStartDate: startDate,
              planEndDate: endDate,
              planDuration: durationInDays,
              active: true,
            },
          });
      } catch (error) {
        console.error("Error retrieving subscription:", error);
      }
      return res.json({ message: "Payment successful" });
    } else {
      return res.json({ message: "Payment failed" });
    }
  } catch (error) {
    res.send(error);
  }
});

app.listen(port, () => {
  console.log(`Now listening on port ${port}`);
});
