const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const JWT_SECRET =
  "PUT_YOUR_SECRET_HERE";
const cookieParser = require("cookie-parser");

const app = express();
const db = new sqlite3.Database("database.db");

function initDB() {
  // create table
  db.run(
    "CREATE TABLE IF NOT EXISTS users (email TEXT, password TEXT, id INTEGER PRIMARY KEY AUTOINCREMENT)",
  );

  // create redirect table
  db.run(
    "CREATE TABLE IF NOT EXISTS redirects (short TEXT, url TEXT, id INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER REFERENCES users(id) ON DELETE CASCADE)",
  );

  // create analylitics table
  db.run(
    "CREATE TABLE IF NOT EXISTS analytics (redirect_id INTEGER REFERENCES redirects(id) ON DELETE CASCADE, ip TEXT, timestamp TEXT, user_agent TEXT)",
  );
}
initDB();

// set public folder as /public
app.use(express.static("public"));

// set body parser
app.use(express.json());
app.use(cookieParser());

// check authentication
const authenticateToken = (req, res, next) => {
  if (!req.cookies) return res.sendStatus(401); // Unauthorized
  const token = req.cookies.token;
  if (!token) return res.sendStatus(401); // Unauthorized

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Forbidden
    req.user = user;
    next();
  });
};

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.get("/dashboard", authenticateToken, (req, res) => {
  const user = req.user;
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.post("api/login", async (req, res) => {
  console.log(req.body);
  const email = req.body.email;
  const password = req.body.password;

  console.log(email + "," + password);

  db.get(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, row) => {
      if (err) {
        res.status(500).send(err.message);
      } else if (row) {
        console.log(row);
        const token = jwt.sign({ email: email, id: row.id }, JWT_SECRET, {
          expiresIn: "1h",
        });
        // set token in cookie
        res.cookie("token", token, { httpOnly: true });
        res.send({
          status: "success",
          token,
          message: "Login successful",
        });
      } else {
        res.status(401).send({
          status: "error",
          message: "Invalid email or password",
        });
      }
    },
  );
});

app.post("/api/link/new", authenticateToken, async (req, res) => {
  const user = req.user;

  console.log("Creating new link for user: " + user.id);

  const short = Math.random().toString(36).substring(2, 7);
  db.get("SELECT * FROM redirects WHERE short = ?", [short], (err, row) => {
    if (err) {
      res.status(500).send({ status: "error", message: err.message });
    } else if (!row) {
      db.run(
        "INSERT INTO redirects (short, url, owner) VALUES (?, ?, ?)",
        [short, req.body.url, user.id],
        (err) => {
          if (err) {
            res.status(500).send({ status: "error", message: err.message });
          } else {
            res.send({
              status: "success",
              link: {
                short: short,
                url: req.body.url,
                clicks: 0,
                last_clicked: "Never",
              },
            });
          }
        },
      );
    }
  });
});

app.post("/api/link/delete", authenticateToken, async (req, res) => {
  const user = req.user;
  const short = req.body.short;
  console.log("Deleting link: " + short + " for user: " + user.id);
  db.get(
    "SELECT * FROM redirects WHERE short = ? AND owner = ?",
    [short, user.id],
    (err, row) => {
      if (err) {
        res.status(500).send({ status: "error", message: err.message });
      } else if (row) {
        db.run("DELETE FROM redirects WHERE short = ?", [short], (err) => {
          if (err) {
            res.status(500).send({ status: "error", message: err.message });
          } else {
            res.send({ status: "success" });
          }
        });
      }
    },
  );
});

app.get("/api/link/:short", async (req, res) => {
  const short = req.params.short;
  db.get("SELECT * FROM redirects WHERE short = ?", [short], (err, row) => {
    if (err) {
      res.status(500).send({ status: "error", message: err.message });
    } else if (row) {
      res.send({ status: "success", url: row.url });
    } else {
      res.status(404).send({ status: "error", message: "Link not found" });
    }
  });
});

app.get("/api/links", authenticateToken, async (req, res) => {
  const user = req.user;
  console.log(user + " Is requesting links");

  db.all("SELECT * FROM redirects WHERE owner = ?", [user.id], (err, rows) => {
    if (err) {
      res.status(500).send({ status: "error", message: err.message });
    } else {
      res.send({ status: "success", links: rows });
      console.log(rows);
    }
  });
});

app.get("/api/analytics/:short", authenticateToken, async (req, res) => {
  const user = req.user;
  const short = req.params.short;
  db.get(
    "SELECT * FROM redirects WHERE short = ? AND owner = ?",
    [short, user.id],
    (err, row) => {
      if (err) {
        res.status(500).send({ status: "error", message: err.message });
      } else if (row) {
        db.all(
          "SELECT * FROM analytics WHERE redirect_id = ?",
          [row.id],
          (err, rows) => {
            if (err) {
              res.status(500).send({ status: "error", message: err.message });
            } else {
              res.send({ status: "success", analytics: rows });
            }
          },
        );
      } else {
        res.status(404).send({ status: "error", message: "Link not found" });
      }
    },
  );
});

// Redirects
app.get("/redirect/:short", (req, res) => {
  console.log("Redirecting " + req.params.short);

  const short = req.params.short;
  db.get("SELECT * FROM redirects WHERE short = ?", [short], (err, row) => {
    if (err) {
      res.status(500).send("Internal server error");
    } else if (row) {
      db.run(
        "INSERT INTO analytics (redirect_id, ip, timestamp, user_agent) VALUES (?, ?, ?, ?)",
        [row.id, req.ip, new Date().toISOString(), req.headers["user-agent"]],
        (err) => {
          if (err) {
            console.log(err);
          } else {
            console.log("Redirecting to: " + row.url);
            res.redirect(row.url);
          }
        },
      );
    }
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
