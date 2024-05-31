const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;
require("dotenv").config();

// middlewares
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.get("/", (req, res) => {
  res.send("Destined Affinity Server is Running");
});

app.listen(port, () => {
  console.log(`Destined Affinity Server is Running on Port ${port}`);
});
