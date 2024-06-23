const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middlewares
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://destined-affinity.web.app",
      "https://destined-affinity.firebaseapp.com",
    ],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xxkyfyl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("destinedAffinityDB");
    const usersCollection = db.collection("users");
    const biodataCollection = db.collection("biodata");
    const accessRequestCollection = db.collection("accessRequest");
    const paymentCollection = db.collection("payments");
    const favoriteCollection = db.collection("favorites");
    const marriageCollection = db.collection("marriages");

    // jwt generate
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Verify Token Middleware
    const verifyToken = async (req, res, next) => {
      const token = req?.cookies?.token;
      console.log(token);
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      if (token) {
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
          if (err) {
            res.status(401).send({ message: "unauthorized access" });
          }
          req.user = decoded;
          next();
        });
      }
    };

    // clear token on logout
    const cookieOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" ? true : false,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    };
    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", { ...cookieOption, maxAge: 0 })
        .send({ success: true });
    });

    // save a user data in db
    app.put("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        // if existing user login again
        return res.send(isExist);
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      // welcome new user
      //   sendEmail(user?.email, {
      //     subject: "Welcome to Stayvista!",
      //     message: `Hope you will find you destination`,
      //   });
      res.send(result);
    });

    const verifyAdmin = async (req, res, next) => {
      console.log("hello");
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result?.role);
      if (!result || result?.role !== "admin")
        return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne(
        { email },
        { projection: { _id: 0, role: 1, status: 1, email: 1 } }
      );
      res.send(result);
    });

    app.get("/marriage-done/:biodataId", async (req, res) => {
      const biodataId = parseInt(req.params.biodataId);

      try {
        // Find a document where fid or mid matches biodataId
        const result = await marriageCollection.findOne({
          $or: [{ fbid: biodataId }, { mbid: biodataId }],
        });

        if (result) {
          // If match found, send "Married" as response
          res.send("Married");
        } else {
          // If no match found, send appropriate message
          res.send("Not Married");
        }
      } catch (error) {
        console.error("Error finding document:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/users-premium", async (req, res) => {
      const sort = req.query.sort === "asc" ? 1 : -1;
      const result = await usersCollection
        .aggregate([
          {
            $match: { status: "premium" },
          },
          {
            $lookup: {
              from: "biodata",
              localField: "email",
              foreignField: "email",
              as: "pbiodata",
            },
          },
          {
            $unwind: "$pbiodata",
          },
          {
            $sort: { "pbiodata.age": sort },
          },
          {
            $project: {
              _id: 0,
              biodataId: "$pbiodata.biodataId",
              sex: "$pbiodata.sex",
              image: "$pbiodata.image",
              permanentDivision: "$pbiodata.permanentDivision",
              age: "$pbiodata.age",
              occupation: "$pbiodata.occupation",
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      let query = {};
      if (req.query.search) {
        // Construct the query with $regex if search query exists
        query = {
          name: { $regex: req.query.search, $options: "i" },
        };
      }
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    app.patch(
      "/users-premium-change/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const update = req.body;
        const filter = { _id: new ObjectId(id) };
        const result = await usersCollection.updateOne(filter, {
          $set: {
            status: update.status,
          },
        });
        res.send(result);
      }
    );

    app.get("/admin-dashboard", verifyToken, verifyAdmin, async (req, res) => {
      const totalBiodataCount = await biodataCollection.countDocuments();

      const maleBiodataCount = await biodataCollection.countDocuments({
        sex: "Male",
      });
      const femaleBiodataCount = await biodataCollection.countDocuments({
        sex: "Female",
      });

      const premiumBiodataCount = await usersCollection.countDocuments({
        status: "premium",
      });

      const totalPayments = await paymentCollection
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: "$price" },
            },
          },
        ])
        .toArray();

      const totalPaymentsSum =
        totalPayments.length > 0 ? totalPayments[0].total : 0;
      res.send({
        totalBiodataCount,
        maleBiodataCount,
        femaleBiodataCount,
        premiumBiodataCount,
        totalPaymentsSum,
      });
    });

    app.get("/count-public", async (req, res) => {
      const totalBiodataCount = await biodataCollection.countDocuments();

      const maleBiodataCount = await biodataCollection.countDocuments({
        sex: "Male",
      });
      const femaleBiodataCount = await biodataCollection.countDocuments({
        sex: "Female",
      });

      const marriageCount = await marriageCollection.countDocuments();

      res.send({
        totalBiodataCount,
        maleBiodataCount,
        femaleBiodataCount,
        marriageCount,
      });
    });

    app.put(
      "/users-premium-change2/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const update = req.body;
        const filter = { email: email };
        const options = { upsert: true };
        const result = await biodataCollection.updateOne(
          filter,
          {
            $set: {
              status: update.status,
            },
          },
          options
        );
        res.send(result);
      }
    );

    app.get(
      "/users-status-pending/:status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.params.status;
        const result = await usersCollection
          .aggregate([
            {
              $match: { status },
            },
            {
              $lookup: {
                from: "biodata",
                localField: "email",
                foreignField: "email",
                as: "pbiodata",
              },
            },
            {
              $unwind: "$pbiodata",
            },
            {
              $project: {
                _id: 1,
                name: 1,
                email: 1,
                status: 1,
                biodataId: "$pbiodata.biodataId",
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );

    app.patch(
      "/users-premium-request/:email",
      verifyToken,
      async (req, res) => {
        const tokenEmail = req.user.email;
        const email = req.params.email;
        if (tokenEmail !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const update = req.body;
        const filter = { email: email };
        const result = await usersCollection.updateOne(filter, {
          $set: {
            status: update.status,
          },
        });
        res.send(result);
      }
    );

    app.patch(
      "/users-role-change/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const update = req.body;
        const filter = { _id: new ObjectId(id) };
        const result = await usersCollection.updateOne(filter, {
          $set: {
            role: update.role,
          },
        });
        res.send(result);
      }
    );

    app.put("/marriages", verifyToken, async (req, res) => {
      const post = req.body;
      const filter = { email: post?.email };

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...post,
        },
      };
      const result = await marriageCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.get("/marriages/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await marriageCollection.findOne({ email });
      res.send(result);
    });

    app.get("/marriages", async (req, res) => {
      const result = await marriageCollection
        .find(
          {},
          {
            projection: {
              _id: 0,
              rate: 1,
              date: 1,
              image: 1,
              story: 1,
            },
          }
        )
        .toArray();
      res.send(result);
    });

    app.get("/marriages-admin", verifyToken, verifyAdmin, async (req, res) => {
      const result = await marriageCollection.find().toArray();
      res.send(result);
    });

    app.put("/biodata", verifyToken, async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };

      const existingBiodata = await biodataCollection.findOne(query);

      // If the document doesn't exist or it doesn't have a biodataId, generate a new one
      let biodataId;
      if (!existingBiodata || !existingBiodata.biodataId) {
        const count = await biodataCollection.countDocuments();
        biodataId = count + 1;
      } else {
        biodataId = existingBiodata.biodataId;
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          biodataId,
        },
      };
      const result = await biodataCollection.updateOne(
        query,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.put("/users-update/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const update = req.body;
      console.log(update.name);
      const filter = { email };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          name: update.name,
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.get("/biodata/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await biodataCollection.findOne({ email });
      res.send(result);
    });

    app.get("/biodata-access-own/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await biodataCollection.findOne(
        { email },
        { projection: { _id: 0, biodataId: 1 } }
      );
      res.send(result);
    });

    app.get("/check-biodata/:email", async (req, res) => {
      const email = req.params.email;
      const result = await biodataCollection.findOne({ email });
      if (result) {
        res.send({ exists: true });
      } else {
        res.send({ exists: false });
      }
    });

    app.get("/biodata-public/:email", async (req, res) => {
      const email = req.params.email;
      const result = await biodataCollection.findOne(
        { email },
        {
          projection: {
            _id: 0,
            biodataId: 1,
            sex: 1,
            image: 1,
            permanentDivision: 1,
            age: 1,
            occupation: 1,
          },
        }
      );
      res.send(result);
    });

    app.get("/biodata-public", async (req, res) => {
      const size = parseInt(req.query.size);
      const page = parseInt(req.query.page) - 1;
      const sfilter = req.query.sfilter;
      const dfilter = req.query.dfilter;
      const minValue = parseInt(req.query.minValue);
      const maxValue = parseInt(req.query.maxValue);
      const maxHeight = parseInt(req.query.maxHeight);
      const minHeight = parseInt(req.query.minHeight);
      let query = {};
      if (dfilter) query.permanentDivision = dfilter;
      if (sfilter) query.sex = sfilter;
      if (!isNaN(minValue) && !isNaN(maxValue)) {
        query.age = { $gte: minValue, $lte: maxValue };
      }
      if (!isNaN(minHeight) && !isNaN(maxHeight)) {
        query.height = { $gte: minHeight, $lte: maxHeight };
      }
      const result = await biodataCollection
        .find(query, {
          projection: {
            _id: 0,
            biodataId: 1,
            sex: 1,
            image: 1,
            permanentDivision: 1,
            age: 1,
            occupation: 1,
            status: 1,
          },
        })
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    app.get("/biodata-public-count", async (req, res) => {
      const sfilter = req.query.sfilter;
      const dfilter = req.query.dfilter;
      const minValue = parseInt(req.query.minValue);
      const maxValue = parseInt(req.query.maxValue);
      const maxHeight = parseInt(req.query.maxHeight);
      const minHeight = parseInt(req.query.minHeight);
      let query = {};
      if (dfilter) query.permanentDivision = dfilter;
      if (sfilter) query.sex = sfilter;
      if (!isNaN(minValue) && !isNaN(maxValue)) {
        query.age = { $gte: minValue, $lte: maxValue };
      }
      if (!isNaN(minHeight) && !isNaN(maxHeight)) {
        query.height = { $gte: minHeight, $lte: maxHeight };
      }
      const count = await biodataCollection.countDocuments(query);

      res.send({ count });
    });

    app.get("/biodata-details/:id", verifyToken, async (req, res) => {
      const id = parseInt(req.params.id);
      const result = await biodataCollection.findOne(
        { biodataId: id },
        { projection: { email: 0, _id: 0, mobile: 0 } }
      );
      res.send(result);
    });

    app.get("/biodata-details-premium/:id", verifyToken, async (req, res) => {
      const id = parseInt(req.params.id);
      const result = await biodataCollection.findOne(
        { biodataId: id },
        { projection: { email: 1, _id: 0, mobile: 1 } }
      );
      res.send(result);
    });

    app.post("/requested-access", verifyToken, async (req, res) => {
      const requests = req.body;
      const { biodataId, email } = req.body;
      const existingRequest = await accessRequestCollection.findOne({
        biodataId,
        email,
      });
      if (existingRequest) {
        res.status(400).send("Access request already pending");
        return;
      }
      const result = await accessRequestCollection.insertOne(requests);
      res.send(result);
    });

    app.get("/requested-access/:id/:email", verifyToken, async (req, res) => {
      const id = parseInt(req.params.id);
      const email = req.params.email;
      const result = await accessRequestCollection.findOne({
        biodataId: id,
        email,
      });
      res.send(result);
    });

    app.get(
      "/requested-access-dashboard/:email",
      verifyToken,
      async (req, res) => {
        const tokenEmail = req.user.email;
        const email = req.params.email;
        if (tokenEmail !== email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        const result = await accessRequestCollection
          .find({
            email,
          })
          .toArray();
        res.send(result);
      }
    );

    app.get(
      "/requested-access-dashb/:status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.params.status;
        const result = await accessRequestCollection.find({ status }).toArray();
        res.send(result);
      }
    );

    app.delete(
      "/requested-access-dashboard/:id",
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await accessRequestCollection.deleteOne(query);
        res.send(result);
      }
    );

    app.patch(
      "/requested-access-dashboard/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const update = req.body;
        const filter = { _id: new ObjectId(id) };
        const result = await accessRequestCollection.updateOne(filter, {
          $set: {
            status: update.status,
          },
        });
        res.send(result);
      }
    );

    // payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount);

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    app.post("/favorites", verifyToken, async (req, res) => {
      const favorite = req.body;
      const { biodataId, favorite_email } = req.body;
      const existingRequest = await favoriteCollection.findOne({
        biodataId,
        favorite_email,
      });
      if (existingRequest) {
        res.status(400).send("Already added to Favorite");
        return;
      }
      const result = await favoriteCollection.insertOne(favorite);
      res.send(result);
    });

    app.get("/favorites/:email", verifyToken, async (req, res) => {
      const tokenEmail = req.user.email;
      const email = req.params.email;
      if (tokenEmail !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await favoriteCollection
        .find({
          favorite_email: email,
        })
        .toArray();
      res.send(result);
    });

    app.delete("/favorites/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favoriteCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Destined Affinity Server is Running");
});

app.listen(port, () => {
  console.log(`Destined Affinity Server is Running on Port ${port}`);
});
