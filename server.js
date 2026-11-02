require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ===== DB =====
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/trendgain";
mongoose.connect(MONGO_URL).then(()=>console.log("✅ MongoDB Connected")).catch(err=>console.log("⚠️ Memory mode", err.message));

const UserSchema = new mongoose.Schema({
  username: String,
  phone: { type: String, unique: true },
  phoneFull: String,
  country: String,
  countryCode: String,
  password: String,
  activated: { type: Boolean, default: false },
  balanceUSD: { type: Number, default: 0 },
  balanceKES: { type: Number, default: 0 },
  answered: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  wrong: { type: Number, default: 0 },
  fails: { type: Number, default: 0 },
  disqualifiedUntil: { type: Date, default: null },
  seenQuestions: { type: [Number], default: [] },
  mpesaCheckoutId: String,
  lastStkAmount: Number,
  withdrawRequests: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', UserSchema);

let memUsers = [];
async function findUser(phone){
  try{ let u = await User.findOne({phone}); if(u) return u; }catch(e){}
  return memUsers.find(u=>u.phone===phone);
}
async function saveUser(userObj){
  try{
    const exists = await User.findOne({phone:userObj.phone});
    if(exists) return exists;
    const u = await User.create(userObj);
    return u;
  }catch(e){
    memUsers.push(userObj);
    return userObj;
  }
}

// ===== DARAJA HELPERS =====
async function getDarajaToken(){
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  if(!key || !secret) throw new Error("Daraja keys missing in .env");
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const env = process.env.DARAJA_ENV || 'sandbox';
  const url = env === 'sandbox' 
    ? 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const res = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return res.data.access_token;
}

function formatPhoneDaraja(phone){
  // 07... -> 2547...
  let p = phone.replace(/\s/g,'').replace(/\+/g,'');
  if(p.startsWith('0')) p = '254' + p.slice(1);
  if(!p.startsWith('254')) p = '254' + p;
  return p;
}

// ===== QUESTIONS DB - 80 =====
let questionsDB = [
  {id:0, cat:"Environment", q:"What is the main gas causing global warming?", options:["Oxygen","Carbon dioxide","Nitrogen","Helium"], answer:1},
  {id:1, cat:"Environment", q:"Which is the largest rainforest?", options:["Congo","Amazon","Daintree","Borneo"], answer:1},
  {id:2, cat:"Environment", q:"What % of Earth is water?", options:["50%","71%","80%","65%"], answer:1},
  {id:3, cat:"History", q:"Who was first president of USA?", options:["Lincoln","Washington","Jefferson","Adams"], answer:1},
  {id:4, cat:"History", q:"Kenya independence?", options:["1960","1963","1965","1970"], answer:1},
  {id:5, cat:"Science", q:"Symbol for Gold?", options:["Go","Gd","Au","Ag"], answer:2},
  {id:6, cat:"Science", q:"H2O is?", options:["Salt","Water","Sugar","Oil"], answer:1},
  {id:7, cat:"Geography", q:"Capital of Japan?", options:["Seoul","Tokyo","Beijing","Bangkok"], answer:1},
  {id:8, cat:"Geography", q:"Largest ocean?", options:["Atlantic","Indian","Arctic","Pacific"], answer:3},
  {id:9, cat:"Agriculture", q:"Staple crop Kenya?", options:["Wheat","Maize","Rice","Barley"], answer:1},
  {id:10, cat:"Technology", q:"Who founded Microsoft?", options:["Jobs","Gates","Musk","Zuckerberg"], answer:1},
  {id:11, cat:"Technology", q:"What does CPU mean?", options:["Central Processing Unit","Computer Power Unit","Central Power Unit","Core Processing Unit"], answer:0},
  {id:12, cat:"Biology", q:"How many chambers in heart?", options:["2","3","4","5"], answer:2},
  {id:13, cat:"Biology", q:"Largest organ?", options:["Heart","Skin","Liver","Brain"], answer:1},
  {id:14, cat:"Physics", q:"Unit of force?", options:["Watt","Newton","Joule","Volt"], answer:1},
  {id:15, cat:"Math", q:"What is 15 x 3?", options:["35","45","55","65"], answer:1},
  {id:16, cat:"Math", q:"Square root of 64?", options:["6","8","7","9"], answer:1},
  {id:17, cat:"General", q:"Red Planet?", options:["Venus","Jupiter","Mars","Saturn"], answer:2},
  {id:18, cat:"General", q:"Who wrote Romeo and Juliet?", options:["Dickens","Shakespeare","Austen","Twain"], answer:1},
  {id:19, cat:"General", q:"Currency of UK?", options:["Euro","Dollar","Pound","Yen"], answer:2}
];

// ===== APIS OLD - HAKUNA KIMEBADILISHWA =====
app.post('/api/create-account', async (req,res)=>{
  const {username, phone, phoneFull, country, countryCode, password} = req.body;
  if(!username || !phone || !password) return res.json({success:false, msg:"Jaza zote"});
  let existing = await findUser(phone);
  if(existing) return res.json({success:false, msg:"Namba hii imeshatumiwa, login"});
  const hashed = await bcrypt.hash(password, 10);
  const userObj = { username, phone, phoneFull: phoneFull||phone, country, countryCode, password:hashed, activated:false, balanceUSD:0, answered:0, correct:0, wrong:0, fails:0, seenQuestions:[] };
  const saved = await saveUser(userObj);
  res.json({success:true, user:saved});
});

app.post('/api/login', async (req,res)=>{
  const {phone, password} = req.body;
  let user = await findUser(phone);
  if(!user) return res.json({success:false, msg:"Account haipo, create kwanza"});
  let ok = false;
  try{ ok = await bcrypt.compare(password, user.password); } catch(e){ ok = user.password===password; }
  if(!ok) return res.json({success:false, msg:"Password sio sahihi"});
  res.json({success:true, user, activated:user.activated});
});

// ===== DARAJA APIS MPYA - ACTIVATE =====
app.post('/api/daraja/stkpush', async (req,res)=>{
  const {phone, amount} = req.body;
  const amt = amount || 100;
  try{
    let user = await findUser(phone);
    if(!user) return res.json({success:false, msg:"User not found"});

    const token = await getDarajaToken();
    const shortcode = process.env.DARAJA_SHORTCODE || '174379';
    const passkey = process.env.DARAJA_PASSKEY;
    const env = process.env.DARAJA_ENV || 'sandbox';
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g,'').slice(0,14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
    const phoneFmt = formatPhoneDaraja(user.phoneFull || phone);

    const url = env === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amt,
      PartyA: phoneFmt,
      PartyB: shortcode,
      PhoneNumber: phoneFmt,
      CallBackURL: process.env.DARAJA_CALLBACK_URL || `https://example.com/api/daraja/callback`,
      AccountReference: `TRENDGAIN-${phone}`,
      TransactionDesc: `Activate ${amt}`
    };

    const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    
    user.mpesaCheckoutId = r.data.CheckoutRequestID;
    user.lastStkAmount = amt;
    if(user.save) await user.save();

    console.log("STK Push sent to", phoneFmt, r.data.CheckoutRequestID);
    res.json({success:true, msg:"STK Push sent, check phone", checkoutId: r.data.CheckoutRequestID, data: r.data});

  }catch(e){
    console.error("STK Error:", e.response?.data || e.message);
    // Fallback kwa demo kama Daraja keys bado hazipo - simulate
    if(!process.env.DARAJA_CONSUMER_KEY){
      console.log("No Daraja keys - simulating STK");
      let user = await findUser(phone);
      if(user){
        user.mpesaCheckoutId = "SIM_"+Date.now();
        if(user.save) await user.save();
      }
      return res.json({success:true, msg:"[SIMULATED] STK Push sent - Enter PIN 1234", checkoutId:"SIM_"+Date.now(), simulated:true});
    }
    res.json({success:false, msg:"STK failed: " + (e.response?.data?.errorMessage || e.message)});
  }
});

app.post('/api/daraja/callback', async (req,res)=>{
  try{
    console.log("Daraja Callback:", JSON.stringify(req.body));
    const body = req.body?.Body?.stkCallback;
    if(!body) return res.json({ResultCode:0, ResultDesc:"Accepted"});

    const checkoutId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;

    // Tafuta user kwa checkoutId
    let user = null;
    try{
      user = await User.findOne({mpesaCheckoutId: checkoutId});
    }catch(e){
      user = memUsers.find(u=>u.mpesaCheckoutId===checkoutId);
    }

    if(user && resultCode===0){
      user.activated = true;
      if(user.save) await user.save();
      else user.activated = true;
      console.log("User activated via M-Pesa:", user.phone);
    }else{
      console.log("Payment failed or user not found", resultCode, checkoutId);
    }

    res.json({ResultCode:0, ResultDesc:"Accepted"});
  }catch(e){
    console.error("Callback error", e.message);
    res.json({ResultCode:0, ResultDesc:"Accepted"});
  }
});

app.post('/api/check-activation', async (req,res)=>{
  const {phone}=req.body;
  let user = await findUser(phone);
  res.json({activated: user?.activated||false, checkoutId: user?.mpesaCheckoutId});
});

// ===== DARAJA B2C - WITHDRAW =====
app.post('/api/daraja/withdraw', async (req,res)=>{
  const {phone, amountKES} = req.body;
  try{
    let user = await findUser(phone);
    if(!user) return res.json({success:false, msg:"User not found"});
    if(!user.activated) return res.json({success:false, msg:"Activate first"});
    if((user.correct||0)<10) return res.json({success:false, msg:"Need 10 correct answers"});
    
    const kes = amountKES || Math.floor((user.balanceUSD||0)*129);
    if(kes<3000) return res.json({success:false, msg:"Min withdraw KES 3000"});

    // Kama Daraja keys hazipo - simulate withdraw
    if(!process.env.DARAJA_CONSUMER_KEY){
      user.balanceUSD = 0;
      user.balanceKES = 0;
      user.correct = 0;
      if(user.save) await user.save();
      return res.json({success:true, msg:`[SIMULATED] KES ${kes} sent to ${user.phoneFull}. Check M-Pesa`, simulated:true, amount:kes});
    }

    const token = await getDarajaToken();
    const env = process.env.DARAJA_ENV || 'sandbox';
    const url = env === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest'
      : 'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest';

    const payload = {
      InitiatorName: process.env.DARAJA_B2C_INITIATOR || 'apitest',
      SecurityCredential: process.env.DARAJA_B2C_SECURITY_CREDENTIAL,
      CommandID: "BusinessPayment",
      Amount: kes,
      PartyA: process.env.DARAJA_B2C_SHORTCODE || process.env.DARAJA_SHORTCODE,
      PartyB: formatPhoneDaraja(user.phoneFull || phone),
      Remarks: `TRENDGAIN Withdraw ${kes}`,
      QueueTimeOutURL: process.env.DARAJA_B2C_QUEUE_TIMEOUT,
      ResultURL: process.env.DARAJA_B2C_RESULT_URL,
      Occasion: "TrendGain Earn"
    };

    const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    console.log("B2C Withdraw:", r.data);

    // Usifute balance mpaka callback ya ResultURL ithibitishe
    user.withdrawRequests = user.withdrawRequests||[];
    user.withdrawRequests.push({ amount: kes, date: new Date(), conversationId: r.data.ConversationID });
    if(user.save) await user.save();

    res.json({success:true, msg:`Withdraw KES ${kes} initiated. Check M-Pesa`, data:r.data});

  }catch(e){
    console.error("B2C Error:", e.response?.data || e.message);
    res.json({success:false, msg:"Withdraw failed: " + (e.response?.data?.errorMessage || e.message)});
  }
});

app.post('/api/daraja/b2c/result', async (req,res)=>{
  console.log("B2C Result:", JSON.stringify(req.body));
  // Hapa ndio utasave kama payment ilifanikiwa - kwa sasa tunakubali tu
  res.json({ResultCode:0, ResultDesc:"Accepted"});
});
app.post('/api/daraja/b2c/timeout', async (req,res)=>{
  console.log("B2C Timeout:", JSON.stringify(req.body));
  res.json({ResultCode:0, ResultDesc:"Accepted"});
});

// ===== QUESTIONS & BALANCE - HAKUNA KIMEBADILISHWA =====
app.post('/api/question', async (req,res)=>{
  try{
    const phone = req.body?.phone;
    let user = null;
    if(phone) user = await findUser(phone);
    let available = questionsDB;
    if(user && user.seenQuestions && user.seenQuestions.length>0){
      available = questionsDB.filter(q=>!user.seenQuestions.includes(q.id));
      if(available.length===0){ available = questionsDB; user.seenQuestions=[]; if(user.save) await user.save(); }
    }
    const randomQ = available[Math.floor(Math.random()*available.length)];
    if(user){
      if(!user.seenQuestions) user.seenQuestions=[];
      user.seenQuestions.push(randomQ.id);
      if(user.save){ try{ await user.save(); }catch(e){} }
    }
    res.json(randomQ);
  }catch(e){
    res.json(questionsDB[Math.floor(Math.random()*questionsDB.length)]);
  }
});
app.get('/api/question', (req,res)=>{ res.json(questionsDB[Math.floor(Math.random()*questionsDB.length)]); });

app.post('/api/answer', async (req,res)=>{
  const {phone, isCorrect}=req.body;
  let user = await findUser(phone);
  if(!user) return res.json({success:false});
  if(user.disqualifiedUntil && Date.now() < new Date(user.disqualifiedUntil).getTime()){
    const secs = Math.ceil((new Date(user.disqualifiedUntil).getTime() - Date.now())/1000);
    return res.json({disqualified:true, seconds: secs});
  }
  user.answered = (user.answered||0)+1;
  if(isCorrect){ user.correct=(user.correct||0)+1; user.fails=0; user.balanceUSD=(user.balanceUSD||0)+1; }
  else{ user.wrong=(user.wrong||0)+1; user.fails=(user.fails||0)+1; if(user.fails>=3){ user.disqualifiedUntil=new Date(Date.now()+60*60*1000); user.fails=0; if(user.save) await user.save(); return res.json({disqualified:true, seconds:3600}); } }
  if(user.save) await user.save();
  res.json({success:true, answered:user.answered, correct:user.correct, wrong:user.wrong, fails:user.fails, balanceUSD:user.balanceUSD, balanceKES:user.balanceUSD*129});
});

app.post('/api/balance', async (req,res)=>{
  const {phone}=req.body;
  let user = await findUser(phone);
  if(!user) return res.json({usd:0,kes:0,answered:0,correct:0,wrong:0,fails:0});
  const usd=user.balanceUSD||0;
  res.json({usd, kes:usd*129, answered:user.answered||0, correct:user.correct||0, wrong:user.wrong||0, fails:user.fails||0, canWithdraw:(user.correct||0)>=10 && usd*129>=3000, disqualifiedUntil:user.disqualifiedUntil});
});

app.listen(process.env.PORT||3000, ()=>console.log('🚀 Server running with Daraja M-Pesa STK + B2C'));