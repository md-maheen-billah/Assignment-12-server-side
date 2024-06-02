const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

// middlewares
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
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

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
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

    app.get("/biodata-public", async (req, res) => {
      const result = await biodataCollection
        .find(
          {},
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
        )
        .toArray();
      res.send(result);
    });

    app.get("/biodata-details/:id", async (req, res) => {
      const id = parseInt(req.params.id);
      const result = await biodataCollection.findOne(
        { biodataId: id },
        { projection: { email: 0, _id: 0, mobile: 0 } }
      );
      res.send(result);
    });

    app.get("/biodata-details-premium/:id", async (req, res) => {
      const id = parseInt(req.params.id);
      const result = await biodataCollection.findOne(
        { biodataId: id },
        { projection: { email: 1, _id: 0, mobile: 1 } }
      );
      res.send(result);
    });

    app.post("/requested-access", async (req, res) => {
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

    app.get("/requested-access/:id/:email", async (req, res) => {
      const id = parseInt(req.params.id);
      const email = req.params.email;
      const result = await accessRequestCollection.findOne({
        biodataId: id,
        email,
      });
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
