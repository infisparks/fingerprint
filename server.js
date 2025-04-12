//--------------------------------------------------
// server.js
//--------------------------------------------------
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios"); // Ensure you have installed axios

// 1) Import Firebase modules
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

// 2) Your Firebase configuration object
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

// 3) Initialize Firebase and get the database
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// 4) Set up Express
const app = express();
const port = 3000;
app.use(bodyParser.json());

// Helper function: sendWhatsApp
async function sendWhatsApp(number, message) {
  try {
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
 *   "rollNumber": "<string>",
 *   "sem": "<string>",
 *   "branch": "<string>"
 * }
 */
app.post("/enroll", async (req, res) => {
  try {
    const { fingerprintID, name, number, rollNumber, sem, branch } = req.body;
    if (!fingerprintID) {
      return res.status(400).json({ error: "Missing fingerprintID" });
    }

    const userData = {
      id: fingerprintID,
      name: name || "",
      number: number || "",
      rollNumber: rollNumber || "",
      sem: sem || "",
      branch: branch || "",
      createdAt: Date.now()
    };

    const newUserRef = push(ref(db, "/users"));
    await set(newUserRef, userData);

    const pushKey = newUserRef.key;
    await update(newUserRef, { pushKey });

    await set(ref(db, `/fingerprints/${fingerprintID}`), pushKey);

    await remove(ref(db, "/id"));

    console.log("New user enrolled with pushKey:", pushKey);

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

    if (!pushKey) {
      const usersSnap = await get(ref(db, "/users"));
      if (!usersSnap.exists()) {
        return res.status(404).json({ error: "No users found in database" });
      }
      const usersData = usersSnap.val();

      pushKey = null;
      for (const key in usersData) {
        if (Object.hasOwnProperty.call(usersData, key)) {
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

      await set(fingerprintRef, pushKey);
    }

    const userRef = ref(db, "/users/" + pushKey);
    const userSnap = await get(userRef);
    if (!userSnap.exists()) {
      return res.status(404).json({ error: "User data missing for fingerprintID" });
    }
    const userData = userSnap.val();

    // Fetch the active subject for this user’s branch and sem
    let actualSubject = "UnknownSubject";
    try {
      const currentAttendanceRef = ref(db, `/currentattendance/${userData.branch}/${userData.sem}`);
      const currentAttendanceSnap = await get(currentAttendanceRef);
      if (currentAttendanceSnap.exists()) {
        const subjectData = currentAttendanceSnap.val();
        if (typeof subjectData === "object" && subjectData.subject) {
          actualSubject = subjectData.subject;
        } else if (typeof subjectData === "string") {
          actualSubject = subjectData;
        }
      }
    } catch (err) {
      console.error("Error fetching current attendance subject:", err.message);
    }

    // Record attendance with the active subject
    const attendanceRef = push(ref(db, `/users/${pushKey}/attendance`));
    const attendanceData = {
      timestamp: Date.now(),
      attended: true,
      subject: actualSubject,
      sem: userData.sem || "",
      branch: userData.branch || ""
    };
    await set(attendanceRef, attendanceData);

    console.log("Attendance marked for pushKey:", pushKey);

    if (userData.number && userData.number.trim() !== "") {
      const dateString = new Date().toLocaleString();
      const msg = `Hello ${userData.name}, your attendance has been marked on ${dateString} for subject: ${actualSubject}. Thank you!`;
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

// Optional: Legacy /register endpoint
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
