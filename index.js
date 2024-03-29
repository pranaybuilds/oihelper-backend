const express = require("express");
const admin = require("firebase-admin");
const serviceAccount = require("./firebaseService/oihelper-firebase-adminsdk-pdkvc-eec93047f1.json");
var sn = require("stocknotejsbridge");
var cron = require("node-cron");
require("dotenv").config();

const userId = process.env.USERID;
const password = process.env.PASSWORD;
const yob = process.env.YOB;
const dbUrl = process.env.DATABASE_URL;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: dbUrl,
});

const db = admin.database();
const optionDataRef = db.ref("optionData").push();

const app = express();
const port = 3000;

const bodyParser = require("body-parser");
const cors = require("cors");

app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

var corsOptions = {
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));

var logindata = {
  body: {
    userId: "DS83807",
    password: "Ass#pass1",
    yob: "1999",
  },
};

async function setSessionToken() {
  try {
    const loginResponse = await sn.snapi.userLogin(logindata);
    const responce = JSON.parse(loginResponse);

    const sessionToken = responce["sessionToken"];
    sn.snapi.setSessionToken(sessionToken);
    console.log("Session Token set:", sessionToken);
  } catch (error) {
    console.error("Error setting Session Token:", error);
  }
}

setSessionToken();

app.get("/optionchain", async (req, res) => {
  try {
    const symbol = req.body.symbol;
    const expiryDate = req.body.expiryDate;
    const strikePrice = req.body.strikePrice;

    const options = {
      expiryDate: expiryDate,
      optionType: sn.constants.OPTION_TYPE_PE,
      strikePrice: strikePrice,
      exchange: sn.constants.EXCHANGE_NFO,
    };

    const optionChainData = await sn.snapi.optionchain(symbol, options);
    res.json(JSON.parse(optionChainData));
  } catch (error) {
    console.error("Error fetching Option Chain:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/indexquote", async (req, res) => {
  try {
    const index = req.body.index;

    const indexQuoteData = await sn.snapi.getIndexQuotes(index);
    res.send(indexQuoteData);
  } catch (error) {
    console.error("Error fetching Index Quote:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/searchoptions", async (req, res) => {
  console.log("Endpoint accessed");
  var search = {
    exchange: sn.constants.EXCHANGE_NFO,
  };

  sn.snapi
    .search("NIFTY", search)
    .then((data) => {
      console.log("Search result received");

      const response = JSON.parse(data);

      const niftyResults = response.searchResults.filter((item) =>
        item.tradingSymbol.startsWith("NIFTY")
      );

      const monthMap = {
        JAN: "01",
        FEB: "02",
        MAR: "03",
        APR: "04",
        MAY: "05",
        JUN: "06",
        JUL: "07",
        AUG: "08",
        SEP: "09",
        OCT: "10",
        NOV: "11",
        DEC: "12",
      };

      const parsedData = niftyResults
        .map((item) => {
          const match = item.tradingSymbol.match(
            /^(\w+?)(\d{2})([A-Z]{3})(\d{2})(\d+)([CEPE]+)$/
          );

          if (match) {
            const day = match[2];
            const month = monthMap[match[3]];
            const year = "20" + match[4];
            const formattedDate = `${year}-${month}-${day}`;

            return {
              symbol: match[1],
              date: formattedDate,
              strikePrice: match[5],
              type: match[6],
            };
          }
          return null;
        })
        .filter((item) => item !== null)
        .filter((item) => item.date.includes("2023-09-21"));

      const collectionRef = db.ref("septemberData");
      collectionRef
        .set(parsedData)
        .then(() => {
          res.json({ "Data save to firebase : ": parsedData });
        })
        .catch((err) => {
          res.status(500).send("Unable to save data to firebase" + err);
        });

      //res.json(parsedData);
    })
    .catch((error) => {
      console.error("Error occurred: ", error);
      res.status(500).send("Internal Server Error");
    });
});

const fetchAndSaveOptionChainData = async (option) => {
  try {
    const symbol = option.symbol === "NIFTY" ? "NIFTY" : "BANKNIFTY";

    const options = {
      expiryDate: "2023-09-28",
      optionType:
        option.type === "CE"
          ? sn.constants.OPTION_TYPE_CE
          : sn.constants.OPTION_TYPE_PE,
      strikePrice: option.strikePrice,
      exchange: sn.constants.EXCHANGE_NFO,
    };

    const optionChainData = await sn.snapi.optionchain(symbol, options);

    return JSON.parse(optionChainData);
  } catch (error) {
    console.error(
      `Error occurred for ${symbol} ${option.date} ${option.strikePrice}:`,
      error
    );
  }
};

app.get("/spotdata", async (req, res) => {
  try {
    console.log("routes here");
    const septemberDataRef = db.ref("septemberData");

    try {
      const snapshot = await septemberDataRef.once("value");
      const septemberData = snapshot.val();

      const batchSize = 1;
      const data = [];
      let sum = 0;
      for (let i = 0; i < Object.values(septemberData).length; i += batchSize) {
        const batchOptions = Object.values(septemberData).slice(
          i,
          i + batchSize
        );
        const promises = batchOptions.map((option) =>
          fetchAndSaveOptionChainData(option)
        );
        const [resData] = await Promise.all(promises);

        const temp = resData.optionChainDetails[0];
        const { bestBids, bestAsks, ...newobj } = temp;

        sum += parseFloat(newobj.spotPrice);
        console.log(newobj.spotPrice, sum);
        data.push(newobj);
      }

      await optionDataRef.push(data);

      const totalOiGraphRef = db.ref("totalOiGraph");

      sumData = {
        timestamp: Date.now(),
        total: sum,
      };

      console.log({
        timestamp: Date.now(),
        total: sum,
      });

      totalOiGraphRef.push(sumData).then(() => {
        console.log("Sum calculated and saved to database");
      });

      console.log("All option data added successfully");
      res.send("All option data added successfully");
    } catch (error) {
      console.error("An error occurred:", error);
      res.status(500).send("Internal Server Error");
    }
  } catch (error) {
    console.error("Error adding option data:", error);
    res.status(500).send("Error adding option data");
  }
});

app.get("/addOIdata", async (req, res) => {
  var ref = db.ref("optionData");
  await ref.once("value", function (snapshot) {
    if (snapshot.exists) {
      var responce = snapshot.val();

      res.send(`${Object.keys(responce).length}`);
    } else {
      console.log("optiondata not exist");
      res.send("optiondata not exist");
    }
  });
});

// cron.schedule("*/2 * * * *", async () => {
//   try {
//     const septemberDataRef = db.ref("septemberData");
//     const snapshot = await septemberDataRef.once("value");
//     const septemberData = snapshot.val();

//     if (!septemberData) {
//       console.log("No September data found.");
//       return res.status(404).send("No September data found.");
//     }

//     const options = Object.values(septemberData);
//     const batchSize = 1;
//     for (let i = 0; i < options.length; i += batchSize) {
//       const batch = options.slice(i, i + batchSize);

//       const promises = batch.map((option) =>
//         fetchAndSaveOptionChainData(option)
//       );

//       await Promise.all(promises);
//     }

//     console.log("All option data added successfully");

//   } catch (error) {
//     console.error("Error adding option data:", error);

//   }
// });

app.get("/", (req, res) => {
  res.send("API Working fine");
});

app.listen(port, () => console.log(`Oihelper app listening on port ${port}!`));
// function printNumbersSequentially() {
//   let i = 1;

//   function printNumber() {
//     console.log(i);
//     i++;

//     if (i <= 3) {
//       setTimeout(printNumber, 300); // Wait for 2 seconds before printing the next number
//     }
//   }

//   printNumber(); // Start the sequence
// }

// printNumbersSequentially();
