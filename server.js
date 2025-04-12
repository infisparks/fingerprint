//--------------------------------------------------
// server.js
//--------------------------------------------------
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios"); // <-- Make sure to install with npm install axios

// 1) Import the modular functions from firebase/app and firebase/database
const { initializeApp } = require("firebase/app");
const {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  remove
} = require("firebase/database");

// 2) Use your provided config object
const firebaseConfig = {
  apiKey: "AIzaSyCiDY2TfTphkwM86FkVMYf-B3m_2ih0jo",
  authDomain: "ambulance-89a48.firebaseapp.com",
  databaseURL: "https://ambulance-89a48-default-rtdb.firebaseio.com",
  projectId: "ambulance-89a48",
  storageBucket: "ambulance-89a48.firebasestorage.app",
  messagingSenderId: "910123117464",
  appId: "1:910123117464:web:4852538866e4a431f599ed",
  measurementId: "G-BS76WR1G13"
};

// 3) Initialize the Firebase app and get the database
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// 4) Set up Express
const app = express();
const port = 3000;
app.use(bodyParser.json());

// Helper function: sendWhatsApp
async function sendWhatsApp(number, message) {
  try {
    // We'll assume the token is always "9958399157" from your example
    // Format the phone number with "91" prefix
    const postBody = {
      token: "9958399157",
      number: `91${number}`,
      message: message
    };
    const response = await axios.post("https://wa.medblisss.com/send-text", postBody);
    console.log("WhatsApp API response:", response.data);
  } catch (err) {
    console.error("Error sending WhatsApp:", err.message);
  }
}

/**
 * GET /enroll
 * Checks if there's an "id" node in Firebase (at /id).
 */
app.get("/enroll", async (req, res) => {
  try {
    const idRef = ref(db, "/id");
    const snap = await get(idRef);

    if (!snap.exists()) {
      return res.json({ enroll: false });
    }
    const data = snap.val();
    return res.json({ enroll: true, data });
  } catch (error) {
    console.error("Error in GET /enroll:", error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /enroll
 * Expected payload: 
 * {
 *   "fingerprintID": <number>,
 *   "name": "<string>",
 *   "number": "<string>",
 *   "rollNumber": "<string>"
 * }
 */
app.post("/enroll", async (req, res) => {
  try {
    const { fingerprintID, name, number, rollNumber } = req.body;
    if (!fingerprintID) {
      return res.status(400).json({ error: "Missing fingerprintID" });
    }

    // Create user data
    const userData = {
      id: fingerprintID,
      name: name || "",
      number: number || "",
      rollNumber: rollNumber || "",
      createdAt: Date.now()
    };

    // 1) Create a new child in /users
    const newUserRef = push(ref(db, "/users"));
    await set(newUserRef, userData);

    // 2) Get the push key and update the record with it
    const pushKey = newUserRef.key;
    await update(newUserRef, { pushKey });

    // 3) Create a mapping for fast lookup: /fingerprints/<fingerprintID> => pushKey
    await set(ref(db, `/fingerprints/${fingerprintID}`), pushKey);

    // 4) Remove the /id node
    await remove(ref(db, "/id"));

    console.log("New user enrolled with pushKey:", pushKey);

    // 5) Send WhatsApp message (if user has phone number)
    if (number && number.trim() !== "") {
      const dateString = new Date().toLocaleString();
      const msg = `Hello ${name}, your enrollment was successful on ${dateString}. Thank you!`;
      await sendWhatsApp(number, msg);
    }

    return res.json({ message: "User enrolled", pushKey });
  } catch (error) {
    console.error("Error in POST /enroll:", error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /attendance
 * Expected payload: { "fingerprintID": <number> }
 */
app.post("/attendance", async (req, res) => {
  try {
    const { fingerprintID } = req.body;
    if (fingerprintID === undefined) {
      return res.status(400).json({ error: "Missing fingerprintID" });
    }

    const fingerprintRef = ref(db, `/fingerprints/${fingerprintID}`);
    const fingerprintSnap = await get(fingerprintRef);
    let pushKey = fingerprintSnap.val();

    // If mapping not found, manually search /users
    if (!pushKey) {
      const usersSnap = await get(ref(db, "/users"));
      if (!usersSnap.exists()) {
        return res.status(404).json({ error: "No users found in database" });
      }
      const usersData = usersSnap.val();

      pushKey = null;
      for (const key in usersData) {
        if (usersData.hasOwnProperty(key)) {
          const user = usersData[key];
          if (Number(user.id) === Number(fingerprintID)) {
            pushKey = key;
            break;
          }
        }
      }

      if (!pushKey) {
        return res.status(404).json({ error: "User not found for fingerprintID" });
      }

      // Save mapping
      await set(fingerprintRef, pushKey);
    }

    // Retrieve user data
    const userRef = ref(db, "/users/" + pushKey);
    const userSnap = await get(userRef);
    if (!userSnap.exists()) {
      return res.status(404).json({ error: "User data missing for fingerprintID" });
    }
    const userData = userSnap.val();

    // Record attendance
    const attendanceRef = push(ref(db, `/users/${pushKey}/attendance`));
    const attendanceData = {
      timestamp: Date.now(),
      attended: true
    };
    await set(attendanceRef, attendanceData);

    console.log("Attendance marked for pushKey:", pushKey);

    // Send WhatsApp if user has number
    if (userData.number && userData.number.trim() !== "") {
      const dateString = new Date().toLocaleString();
      const msg = `Hello ${userData.name}, your attendance has been marked on ${dateString}. Thank you!`;
      await sendWhatsApp(userData.number, msg);
    }

    return res.json({
      message: `Attendance marked for user ${userData.name}`,
      name: userData.name,
      pushKey,
      attendanceData
    });
  } catch (error) {
    console.error("Error in /attendance:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Optional: Legacy /register
app.post("/register", async (req, res) => {
  try {
    const { id, name } = req.body;
    if (id === undefined) {
      return res.status(400).json({ error: "Missing fingerprint ID" });
    }

    const userData = {
      id,
      name: name || "",
      createdAt: Date.now()
    };

    const newUserRef = push(ref(db, "/users"));
    await set(newUserRef, userData);

    const pushKey = newUserRef.key;
    await update(newUserRef, { pushKey });

    await set(ref(db, `/fingerprints/${id}`), pushKey);

    console.log("User registered with pushKey:", pushKey);
    res.json({ message: "User registered", pushKey });
  } catch (error) {
    console.error("Error in /register:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Node.js Express server listening on port ${port}`);
});
