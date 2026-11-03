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
  let p = phone.replace(/\s/g,'').replace(/\+/g,'');
  if(p.startsWith('0')) p = '254' + p.slice(1);
  if(!p.startsWith('254')) p = '254' + p;
  return p;
}

// ===== QUESTIONS DB - 210 NGUMU (20 OLD + 190 NEW) =====
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
  {id:19, cat:"General", q:"Currency of UK?", options:["Euro","Dollar","Pound","Yen"], answer:2},

  // ====== MASWALI MAPYA NGUMU 20-210 ======
  {id:20, cat:"Science Hard", q:"What is the Heisenberg Uncertainty Principle about?", options:["Speed of light is constant","Cannot know exact position and momentum simultaneously","Energy cannot be created","Gravity bends light"], answer:1},
  {id:21, cat:"Science Hard", q:"CRISPR is used for?", options:["Gene editing","Water purification","Fuel","Plastic"], answer:0},
  {id:22, cat:"Physics Hard", q:"What particle has negative charge?", options:["Proton","Neutron","Electron","Photon"], answer:2},
  {id:23, cat:"Physics Hard", q:"Escape velocity of Earth approx?", options:["7.9 km/s","11.2 km/s","15 km/s","9.8 km/s"], answer:1},
  {id:24, cat:"Chemistry Hard", q:"pH of pure water at 25C?", options:["6","7","8","5"], answer:1},
  {id:25, cat:"Biology Hard", q:"Mitochondria is known as?", options:["Suicide bag","Powerhouse of cell","Brain of cell","Protein factory"], answer:1},
  {id:26, cat:"Biology Hard", q:"How many chromosomes humans have?", options:["44","46","48","42"], answer:1},
  {id:27, cat:"Math Hard", q:"Derivative of x^3 is?", options:["2x^2","3x^2","x^2","3x"], answer:1},
  {id:28, cat:"Math Hard", q:"What is 0! (0 factorial)?", options:["0","1","Undefined","10"], answer:1},
  {id:29, cat:"Math Hard", q:"Integral of 1/x dx is?", options:["ln|x| + C","x^2","1/x^2","e^x"], answer:0},
  {id:30, cat:"Geography Hard", q:"Which desert is largest hot desert?", options:["Gobi","Sahara","Kalahari","Arabian"], answer:1},
  {id:31, cat:"Geography Hard", q:"Strait separating Africa and Europe?", options:["Bering","Gibraltar","Malacca","Hormuz"], answer:1},
  {id:32, cat:"History Hard", q:"Berlin Wall fell in?", options:["1987","1989","1991","1985"], answer:1},
  {id:33, cat:"History Hard", q:"Who discovered penicillin?", options:["Fleming","Curie","Pasteur","Newton"], answer:0},
  {id:34, cat:"Technology Hard", q:"What does DNS stand for?", options:["Domain Name System","Data Network Service","Digital Node System","Domain Network Security"], answer:0},
  {id:35, cat:"Technology Hard", q:"Bitcoin whitepaper published in?", options:["2007","2008","2009","2010"], answer:1},
  {id:36, cat:"Economics Hard", q:"What is stagflation?", options:["High inflation + stagnant growth + unemployment","Low inflation","Deflation","Growth only"], answer:0},
  {id:37, cat:"Economics Hard", q:"GDP stands for?", options:["Gross Domestic Product","General Domestic Price","Global Demand Product","Gross Demand Profit"], answer:0},
  {id:38, cat:"Trading Hard", q:"What is a Fair Value Gap (FVG)?", options:["3-candle imbalance where price didn't trade efficiently","A support","A moving average","News gap only"], answer:0},
  {id:39, cat:"Trading Hard", q:"Buy Side Liquidity is?", options:["Stops below lows","Stops above highs ready to be swept","Support","Volume"], answer:1},
  {id:40, cat:"Trading Hard", q:"What is OTE in ICT?", options:["Optimal Trade Entry 62-79% fib of displacement","Open Trade Entry","Over Time Entry","Order To Exit"], answer:0},
  {id:41, cat:"Trading Hard", q:"What does FOMC do?", options:["Sets US monetary policy and interest rates","Mines Bitcoin","Regulates oil","Makes phones"], answer:0},
  {id:42, cat:"Trading Hard", q:"Risk management rule: If you risk 1% on $1000 with 50 pips SL, risk amount is?", options:["$100","$10","$50","$1"], answer:1},
  {id:43, cat:"IQ", q:"If 2=6, 3=12, 4=20, then 5=?", options:["25","30","35","40"], answer:1},
  {id:44, cat:"IQ", q:"Which number is next: 2, 6, 12, 20, 30, ?", options:["40","42","44","48"], answer:1},
  {id:45, cat:"Science", q:"Speed of light?", options:["300,000 km/s","150,000 km/s","500,000 km/s","100,000 km/s"], answer:0},
  {id:46, cat:"Geography", q:"Which country has most islands?", options:["Philippines","Sweden","Indonesia","Japan"], answer:1},
  {id:47, cat:"History", q:"Mau Mau uprising mainly in?", options:["Kenya","Ghana","Nigeria","Uganda"], answer:0},
  {id:48, cat:"Technology", q:"What is API?", options:["Application Programming Interface","Advanced Programming Internet","App Process Integration","Applied Program Info"], answer:0},
  {id:49, cat:"Math Hard", q:"What is log10(1000)?", options:["2","3","4","10"], answer:1},
  {id:50, cat:"Biology Hard", q:"Blood group universal donor?", options:["AB","O-","A+","B+"], answer:1},
  {id:51, cat:"Physics Hard", q:"E=mc^2 discovered by?", options:["Newton","Einstein","Tesla","Bohr"], answer:1},
  {id:52, cat:"Environment Hard", q:"Ozone layer depletion caused by?", options:["CO2","CFCs","Methane","Oxygen"], answer:1},
  {id:53, cat:"Trading Hard", q:"What is Breaker Block?", options:["Failed Order Block that flips polarity","A moving average","A news event","A broker"], answer:0},
  {id:54, cat:"Trading Hard", q:"Market Structure Shift needs?", options:["Wick only","Body close beyond last swing with displacement","RSI cross","MA cross"], answer:1},
  {id:55, cat:"Psychology", q:"What is revenge trading?", options:["Good strategy","Emotional trading after loss to recover quickly - leads to bigger loss","Professional method","Hedging"], answer:1},
  {id:56, cat:"Geography Hard", q:"Capital of Australia?", options:["Sydney","Melbourne","Canberra","Perth"], answer:2},
  {id:57, cat:"History Hard", q:"WW2 ended in?", options:["1943","1945","1947","1950"], answer:1},
  {id:58, cat:"Science Hard", q:"Human brain has approx how many neurons?", options:["1 million","86 billion","10 billion","1 trillion"], answer:1},
  {id:59, cat:"Math Hard", q:"What is 7^3?", options:["343","49","21","353"], answer:0},
  {id:60, cat:"Technology Hard", q:"Solidity is used for?", options:["Smart contracts on Ethereum","AI","Web design","Databases"], answer:0},
  {id:61, cat:"Image Q", q:"Identify this country by flag", options:["Kenya","Uganda","Tanzania","Rwanda"], answer:0, image:"https://flagcdn.com/w320/ke.png"},
  {id:62, cat:"Image Q", q:"What is this structure?", options:["Eiffel Tower","Burj Khalifa","Statue of Liberty","Big Ben"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg"},
  {id:63, cat:"Image Q", q:"This is symbol for which element?", options:["Gold","Silver","Iron","Copper"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Au_element.svg/200px-Au_element.svg.png"},
  {id:64, cat:"Image Q", q:"Which planet is this?", options:["Mars","Jupiter","Saturn","Neptune"], answer:2, image:"https://upload.wikimedia.org/wikipedia/commons/c/c7/Saturn_during_Equinox.jpg"},
  {id:65, cat:"Image Q", q:"What chart pattern is this? (Double top)", options:["Bullish","Bearish reversal","Continuation","No pattern"], answer:1, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Double_Top.png/300px-Double_Top.png"},
  {id:66, cat:"Trading Hard", q:"What is Premium vs Discount?", options:["Above 50% of range = premium (sell), below = discount (buy)","Expensive broker","Cheap broker","No concept"], answer:0},
  {id:67, cat:"Trading Hard", q:"Judas Swing occurs?", options:["During London Open - false move to take liquidity before real move","Weekend","Midnight","Always"], answer:0},
  {id:68, cat:"Trading Hard", q:"Power of 3: AMD means?", options:["Accumulation Manipulation Distribution","All Market Down","Average Move Daily","Asset Management Division"], answer:0},
  {id:69, cat:"Economics Hard", q:"What is quantitative easing?", options:["Central bank buying securities to inject money","Increasing taxes","Reducing money","Banning banks"], answer:0},
  {id:70, cat:"Math Hard", q:"If price is 100 and drops 50%, needs what % to return to 100?", options:["50%","75%","100%","25%"], answer:2},
  {id:71, cat:"Science Hard", q:"What is DNA full form?", options:["Deoxyribonucleic Acid","Digital Network Array","Dynamic Acid","Data Nucleus Acid"], answer:0},
  {id:72, cat:"History Hard", q:"Who was Tom Mboya?", options:["Kenyan trade unionist and politician","President of Tanzania","Musician","Footballer"], answer:0},
  {id:73, cat:"Geography Hard", q:"Nile River flows into?", options:["Mediterranean Sea","Indian Ocean","Atlantic","Red Sea"], answer:0},
  {id:74, cat:"Technology Hard", q:"What is blockchain?", options:["Distributed immutable ledger","A type of chain","Centralized database","Internet cable"], answer:0},
  {id:75, cat:"Biology Hard", q:"What is photosynthesis equation?", options:["6CO2+6H2O->C6H12O6+6O2","O2+CO2->H2O","H2O->O2","CO2->O2"], answer:0},
  {id:76, cat:"Trading Hard", q:"Why do most breakouts fail?", options:["They are inducement at internal liquidity, not taking external","Broker manipulation only","No reason","Luck"], answer:0},
  {id:77, cat:"Trading Hard", q:"What is Consequent Encroachment of FVG?", options:["Top of FVG","50% level of FVG","Bottom","No meaning"], answer:1},
  {id:78, cat:"Trading Hard", q:"What is Inversion FVG?", options:["Failed FVG that flips to support/resistance","Same as FVG","No such","Indicator"], answer:0},
  {id:79, cat:"IQ Hard", q:"A bat and ball cost $1.10, bat costs $1 more than ball. Ball costs?", options:["$0.10","$0.05","$0.15","$1"], answer:1},
  {id:80, cat:"Science Hard", q:"Which blood cells fight infection?", options:["Red","White","Platelets","Plasma"], answer:1},
  {id:81, cat:"Environment Hard", q:"What is carbon footprint?", options:["Total greenhouse gases caused by individual/event/product","Foot size","Shoe brand","Soil type"], answer:0},
  {id:82, cat:"Geography Hard", q:"Which is deepest ocean trench?", options:["Tonga","Mariana","Puerto Rico","Java"], answer:1},
  {id:83, cat:"History Hard", q:"Who wrote 'Things Fall Apart'?", options:["Chinua Achebe","Wole Soyinka","Ngugi wa Thiong'o","Achebe was wrong"], answer:0},
  {id:84, cat:"Technology Hard", q:"What does VPN stand for?", options:["Virtual Private Network","Very Private Network","Verified Public Network","Virtual Public Node"], answer:0},
  {id:85, cat:"Math Hard", q:"What is Fibonacci sequence start?", options:["0,1,1,2,3,5","1,2,3,4","2,4,6,8","1,1,2,3"], answer:0},
  {id:86, cat:"Trading Hard", q:"What is best confluence for A+ setup?", options:["HTF OB + liquidity sweep + MSS + FVG + Killzone time","One indicator","Random","News only"], answer:0},
  {id:87, cat:"Trading Hard", q:"Why averaging down kills accounts?", options:["Good strategy","Doubles risk, turns small loss into blow","Pro method","Always works"], answer:1},
  {id:88, cat:"Psychology Hard", q:"What is confirmation bias in trading?", options:["Seeking info that confirms your existing bias, ignoring opposite","Good bias","No bias","Always correct"], answer:0},
  {id:89, cat:"Science Hard", q:"What is CRISPR Cas9?", options:["Gene editing tool","Virus","Bacteria","Protein"], answer:0},
  {id:90, cat:"Image Q", q:"This logo is for which company?", options:["Apple","Microsoft","Linux","Android"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg"},
  {id:91, cat:"Image Q", q:"Identify this famous building", options:["Burj Khalifa","Empire State","Eiffel","Shanghai Tower"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Burj_Khalifa.jpg/200px-Burj_Khalifa.jpg"},
  {id:92, cat:"Trading Hard", q:"What is funding rate telling you?", options:["High positive = crowded longs, potential long squeeze","No info","Always bullish","Always bearish"], answer:0},
  {id:93, cat:"Trading Hard", q:"What is liquidity void?", options:["Fast displacement leaving imbalance, price often returns","Slow move","Sideways","Any candle"], answer:0},
  {id:94, cat:"Trading Hard", q:"If BTC takes ATH then closes below with FVG, what?", options:["High probability reversal to discount, liquidity taken","Continue up forever","No meaning","Buy more"], answer:0},
  {id:95, cat:"Economics Hard", q:"What is hyperinflation?", options:["Extremely high and rapid inflation >50% per month","Low inflation","Deflation","Normal"], answer:0},
  {id:96, cat:"Geography Hard", q:"Which line is 0 degrees latitude?", options:["Equator","Prime Meridian","Tropic of Cancer","Tropic of Capricorn"], answer:0},
  {id:97, cat:"Science Hard", q:"What is absolute zero in Celsius?", options:["0C","-273.15C","-100C","-459C"], answer:1},
  {id:98, cat:"Math Hard", q:"What is Pythagorean theorem?", options:["a^2+b^2=c^2","a+b=c","a*b=c","a^2-b^2=c^2"], answer:0},
  {id:99, cat:"History Hard", q:"Mansa Musa was ruler of?", options:["Mali Empire","Egypt","Songhai","Ghana"], answer:0},
  {id:100, cat:"Technology Hard", q:"What is difference between Proof of Work and Proof of Stake?", options:["PoW uses mining energy, PoS uses staking","Same","PoS uses more energy","No difference"], answer:0},
  {id:101, cat:"Trading Hard", q:"What is Mitigation Block?", options:["Where price failed to reach OB and caused opposite move, used for retest","Same as OB","Indicator","No block"], answer:0},
  {id:102, cat:"Trading Hard", q:"How to trade HTF to LTF?", options:["HTF bias, LTF entry only in HTF direction after sweep","Ignore HTF","Trade opposite","Any LTF"], answer:0},
  {id:103, cat:"Trading Hard", q:"What is Silver Bullet in ICT?", options:["Time window 10-11am or 2-3pm NY hunting liquidity with MSS","Random entry","Indicator","All day"], answer:0},
  {id:104, cat:"Trading Hard", q:"Internal vs External Liquidity?", options:["External is HTF highs/lows, Internal is range liquidity","Same","Internal is news","External is indicator"], answer:0},
  {id:105, cat:"IQ Hard", q:"If all Bloops are Razzies and some Razzies are Loppies, are some Bloops Loppies?", options:["Yes","No","Maybe, not necessarily","Impossible"], answer:2},
  {id:106, cat:"Science Hard", q:"What causes tides?", options:["Wind","Gravitational pull of moon and sun","Earth rotation only","Fish"], answer:1},
  {id:107, cat:"Biology Hard", q:"What is the smallest bone in human body?", options:["Stapes in ear","Femur","Tibia","Ulna"], answer:0},
  {id:108, cat:"Geography Hard", q:"What is the capital of Canada?", options:["Toronto","Vancouver","Ottawa","Montreal"], answer:2},
  {id:109, cat:"History Hard", q:"Who was first man in space?", options:["Neil Armstrong","Yuri Gagarin","Buzz Aldrin","John Glenn"], answer:1},
  {id:110, cat:"Technology Hard", q:"What is machine learning?", options:["AI that learns from data without explicit programming","Learning to use machines","Machine repair","Robot"], answer:0},
  {id:111, cat:"Image Q", q:"Which country flag is this?", options:["USA","UK","Australia","Canada"], answer:0, image:"https://flagcdn.com/w320/us.png"},
  {id:112, cat:"Image Q", q:"What animal is this?", options:["Lion","Tiger","Leopard","Cheetah"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/4/43/Lion_1.jpg"},
  {id:113, cat:"Trading Hard", q:"What does 'Liquidity is the real trend' mean?", options:["Price moves from liquidity to liquidity taking stops","Price follows news","Trend doesn't exist","Only indicators"], answer:0},
  {id:114, cat:"Trading Hard", q:"How to avoid being liquidity?", options:["Don't buy equal highs or sell equal lows, wait for sweep + displacement","Chase breakout","Use big lot","Trade news only"], answer:0},
  {id:115, cat:"Economics Hard", q:"What is bull market vs bear market?", options:["Bull up 20%+, Bear down 20%+","Same","Bull down","Bear up"], answer:0},
  {id:116, cat:"Math Hard", q:"Probability of getting heads twice in 2 coin tosses?", options:["25%","50%","75%","100%"], answer:0},
  {id:117, cat:"Science Hard", q:"What is the hardest natural substance?", options:["Gold","Diamond","Iron","Silver"], answer:1},
  {id:118, cat:"Biology Hard", q:"How long does red blood cell live?", options:["10 days","120 days","1 year","30 days"], answer:1},
  {id:119, cat:"Geography Hard", q:"Mount Kilimanjaro located in?", options:["Kenya","Tanzania","Uganda","Ethiopia"], answer:1},
  {id:120, cat:"History Hard", q:"Who invented telephone?", options:["Edison","Bell","Tesla","Marconi"], answer:1},
  {id:121, cat:"Technology Hard", q:"What is phishing?", options:["Fraudulent attempt to get sensitive info by disguising as trustworthy","Fishing in tech","A programming language","A virus only"], answer:0},
  {id:122, cat:"Trading Hard", q:"What is position sizing formula?", options:["Risk $ = % balance / stop distance","Random lot","Max lot","No formula"], answer:0},
  {id:123, cat:"Trading Hard", q:"Why journaling is mandatory?", options:["No data to improve, repeat mistakes, no edge tracking","Waste time","Memory enough","Not needed"], answer:0},
  {id:124, cat:"Math Hard", q:"What is 2^10?", options:["512","1024","2048","1000"], answer:1},
  {id:125, cat:"Science Hard", q:"What is the largest planet?", options:["Earth","Jupiter","Saturn","Neptune"], answer:1},
  {id:126, cat:"Geography Hard", q:"How many time zones Russia has?", options:["6","9","11","12"], answer:2},
  {id:127, cat:"History Hard", q:"When was UN founded?", options:["1943","1945","1947","1950"], answer:1},
  {id:128, cat:"Technology Hard", q:"What does HTML stand for?", options:["HyperText Markup Language","High Tech Modern Language","Hyper Transfer Markup Language","Home Tool Markup Language"], answer:0},
  {id:129, cat:"Biology Hard", q:"What is the function of hemoglobin?", options:["Fight infection","Carry oxygen","Clot blood","Digest"], answer:1},
  {id:130, cat:"Image Q", q:"What is this currency symbol?", options:["Dollar $","Euro €","Bitcoin ₿","Yen ¥"], answer:2, image:"https://upload.wikimedia.org/wikipedia/commons/4/46/Bitcoin.svg"},
  {id:131, cat:"Trading Hard", q:"What is a stop hunt volume signature?", options:["High volume spike with wick beyond level then rejection","Low volume","No volume","Normal volume"], answer:0},
  {id:132, cat:"Trading Hard", q:"Explain weekend risk", options:["Forex closed gap risk, crypto low liquidity manipulation","No risk","Weekend always profitable","Same as weekday"], answer:0},
  {id:133, cat:"Economics Hard", q:"What is ROI?", options:["Return On Investment (profit/cost)","Rate Of Interest","Risk Of Investment","Return Of Income"], answer:0},
  {id:134, cat:"Math Hard", q:"Solve: 8 / 2(2+2) = ?", options:["16","1","4","8"], answer:0},
  {id:135, cat:"Science Hard", q:"What element has atomic number 79?", options:["Silver","Gold","Mercury","Lead"], answer:1},
  {id:136, cat:"Geography Hard", q:"What is the longest river?", options:["Nile","Amazon","Yangtze","Mississippi"], answer:0},
  {id:137, cat:"History Hard", q:"Who was Cleopatra?", options:["Last active ruler of Ptolemaic Kingdom of Egypt","Queen of England","Goddess","Wife of Caesar only"], answer:0},
  {id:138, cat:"Technology Hard", q:"What is an algorithm?", options:["Step-by-step procedure to solve problem","A type of computer","Internet","Software only"], answer:0},
  {id:139, cat:"Biology Hard", q:"What is the largest human cell?", options:["Sperm","Ovum (egg cell)","Skin cell","Neuron"], answer:1},
  {id:140, cat:"Image Q", q:"Identify this person (Albert Einstein)", options:["Newton","Einstein","Tesla","Edison"], answer:1, image:"https://upload.wikimedia.org/wikipedia/commons/d/d3/Albert_Einstein_Head.jpg"},
  {id:141, cat:"Trading Hard", q:"What is the difference between Displacement and Momentum?", options:["Displacement is aggressive leg leaving inefficiency, momentum is general speed","Same","Displacement is slow","No difference"], answer:0},
  {id:142, cat:"Trading Hard", q:"How to identify institutional candle?", options:["Full body + close near high/low + volume, not many wicks","Small wick","Doji only","Red only"], answer:0},
  {id:143, cat:"Trading Hard", q:"What is re-accumulation?", options:["Range after uptrend before continuation higher","End of trend","Reversal always","No meaning"], answer:0},
  {id:144, cat:"Economics Hard", q:"What is deflation?", options:["Decrease in general price levels","Increase in prices","Stable prices","High growth"], answer:0},
  {id:145, cat:"Math Hard", q:"What is sin(90 degrees)?", options:["0","1","-1","0.5"], answer:1},
  {id:146, cat:"Science Hard", q:"What is the most abundant gas in atmosphere?", options:["Oxygen","Nitrogen","CO2","Hydrogen"], answer:1},
  {id:147, cat:"Geography Hard", q:"Which country borders both Atlantic and Indian Ocean?", options:["South Africa","Kenya","Mozambique","Namibia"], answer:0},
  {id:148, cat:"History Hard", q:"Who was Jomo Kenyatta?", options:["First President of Kenya","Second President","Prime Minister","Chief"], answer:0},
  {id:149, cat:"Technology Hard", q:"What is cloud computing?", options:["Delivery of computing services over internet","Weather computing","A cloud","Storage only"], answer:0},
  {id:150, cat:"Biology Hard", q:"What is the function of chlorophyll?", options:["Absorb light for photosynthesis","Absorb water","Provide structure","Store food"], answer:0},
  {id:151, cat:"Image Q", q:"What is this famous painting?", options:["Mona Lisa","Starry Night","The Scream","Last Supper"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/6/6a/Mona_Lisa.jpg"},
  {id:152, cat:"Trading Hard", q:"What is liquidity sweep vs BOS?", options:["Sweep takes liquidity wick, BOS is body close breaking structure","Same","Sweep is BOS","No difference"], answer:0},
  {id:153, cat:"Trading Hard", q:"How to manage after 1:1 hit?", options:["Move to breakeven + partials, let runner to external liquidity","Close all","Add more","Hold loss"], answer:0},
  {id:154, cat:"Trading Hard", q:"Scalp vs Swing targets?", options:["Scalp internal range, Intraday session highs/lows, Swing HTF external","All same","Scalp is HTF","Swing is 1 min"], answer:0},
  {id:155, cat:"IQ Hard", q:"If you have 3 apples and take away 2, how many you have?", options:["1","2","3","5"], answer:1},
  {id:156, cat:"Science Hard", q:"What is the chemical symbol for water?", options:["H2O","CO2","O2","NaCl"], answer:0},
  {id:157, cat:"Geography Hard", q:"Which continent is driest?", options:["Sahara","Antarctica","Australia","Africa"], answer:1},
  {id:158, cat:"History Hard", q:"What year did Titanic sink?", options:["1910","1912","1914","1915"], answer:1},
  {id:159, cat:"Technology Hard", q:"Who founded Tesla Motors?", options:["Elon Musk","Martin Eberhard and Marc Tarpenning","Jeff Bezos","Bill Gates"], answer:1},
  {id:160, cat:"Math Hard", q:"What is 1+2+3+...+100?", options:["5000","5050","5500","4950"], answer:1},
  {id:161, cat:"Biology Hard", q:"What is the largest mammal?", options:["Elephant","Blue Whale","Giraffe","Shark"], answer:1},
  {id:162, cat:"Image Q", q:"What is this animal? (Panda)", options:["Bear","Panda","Koala","Raccoon"], answer:1, image:"https://upload.wikimedia.org/wikipedia/commons/0/0f/Grosser_Panda.JPG"},
  {id:163, cat:"Trading Hard", q:"What is unmitigated Order Block?", options:["OB that price hasn't returned to, high probability to return","Already touched","Weak OB","Fake OB"], answer:0},
  {id:164, cat:"Trading Hard", q:"Role of 200 EMA?", options:["Dynamic support/resistance and institutional bias filter","Entry always","Useless","Only scalping"], answer:0},
  {id:165, cat:"Trading Hard", q:"Why equal lows under consolidation lead to strong upside?", options:["Stops below equal lows fuel upside when swept","Support strong","Random","No reason"], answer:0},
  {id:166, cat:"Economics Hard", q:"What is market cap?", options:["Price x circulating supply","Price only","Supply only","Volume"], answer:0},
  {id:167, cat:"Math Hard", q:"What is 5! ?", options:["25","120","60","100"], answer:1},
  {id:168, cat:"Science Hard", q:"What is the smallest unit of matter?", options:["Atom","Molecule","Cell","Electron"], answer:0},
  {id:169, cat:"Geography Hard", q:"What is the highest mountain?", options:["K2","Everest","Kilimanjaro","Elbrus"], answer:1},
  {id:170, cat:"History Hard", q:"Who was Nelson Mandela?", options:["First black President of South Africa","President of Kenya","Musician","Actor"], answer:0},
  {id:171, cat:"Technology Hard", q:"What is open source?", options:["Source code publicly available","Closed code","Paid only","No code"], answer:0},
  {id:172, cat:"Biology Hard", q:"What is the powerhouse of cell?", options:["Nucleus","Mitochondria","Ribosome","Chloroplast"], answer:1},
  {id:173, cat:"Image Q", q:"What is this planet Earth from space?", options:["Mars","Earth","Jupiter","Moon"], answer:1, image:"https://upload.wikimedia.org/wikipedia/commons/9/97/The_Earth_seen_from_Apollo_17.jpg"},
  {id:174, cat:"Trading Hard", q:"What is Dollar Cost Averaging (DCA)?", options:["Investing fixed amount regularly regardless of price","Buying all at once","Selling all","Leverage"], answer:0},
  {id:175, cat:"Trading Hard", q:"What is max drawdown?", options:["Largest peak to trough decline","Profit","Win rate","No loss"], answer:0},
  {id:176, cat:"Economics Hard", q:"What is inflation?", options:["General increase in prices, purchasing power falls","Decrease in prices","Stable prices","Growth"], answer:0},
  {id:177, cat:"Math Hard", q:"What is mode of 2,3,3,4,5?", options:["2","3","4","5"], answer:1},
  {id:178, cat:"Science Hard", q:"What is the speed of sound in air?", options:["343 m/s","300 m/s","500 m/s","100 m/s"], answer:0},
  {id:179, cat:"Geography Hard", q:"Which country is known as Land of Rising Sun?", options:["China","Japan","Korea","Thailand"], answer:1},
  {id:180, cat:"History Hard", q:"When did Kenya get independence?", options:["1960","1963","1964","1965"], answer:1},
  {id:181, cat:"Technology Hard", q:"What is 5G?", options:["5th generation mobile network","5 gigabytes","5 games","5G is WiFi"], answer:0},
  {id:182, cat:"Biology Hard", q:"How many bones in adult human?", options:["206","213","196","220"], answer:0},
  {id:183, cat:"Image Q", q:"Which element periodic table is this? Fe", options:["Iron","Fluorine","Gold","Silver"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Fe-TableImage.png/200px-Fe-TableImage.png"},
  {id:184, cat:"Trading Hard", q:"What is Killzone?", options:["Specific high volatility times: London Open, NY Open","Random time","Night only","Weekend"], answer:0},
  {id:185, cat:"Trading Hard", q:"What is Turtle Soup?", options:["Liquidity grab - price takes previous high/low then immediately reverses","Soup","Indicator","Pattern bullish only"], answer:0},
  {id:186, cat:"Economics Hard", q:"What is compound interest?", options:["Interest on interest","Simple interest","No interest","Negative interest"], answer:0},
  {id:187, cat:"Math Hard", q:"What is 12 x 12?", options:["124","144","132","154"], answer:1},
  {id:188, cat:"Science Hard", q:"What is gravity on Moon vs Earth?", options:["Same","1/6 of Earth","1/2 of Earth","Double"], answer:1},
  {id:189, cat:"Geography Hard", q:"Which river is longest in Africa?", options:["Congo","Nile","Niger","Zambezi"], answer:1},
  {id:190, cat:"History Hard", q:"Who discovered America in 1492?", options:["Columbus","Vasco da Gama","Magellan","Cook"], answer:0},
  {id:191, cat:"Technology Hard", q:"What is Git?", options:["Version control system","A programming language","A database","A browser"], answer:0},
  {id:192, cat:"Biology Hard", q:"What is the largest internal organ?", options:["Heart","Liver","Lung","Brain"], answer:1},
  {id:193, cat:"Image Q", q:"What is this famous landmark in Kenya?", options:["Elephant Tusks Mombasa","Eiffel Tower","Big Ben","Statue"], answer:0, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mombasa_Tusks.jpg/320px-Mombasa_Tusks.jpg"},
  {id:194, cat:"Trading Hard", q:"What is Smart Money Concept?", options:["Trading based on institutional order flow, liquidity, market structure","Retail indicator","Gambling","News only"], answer:0},
  {id:195, cat:"Trading Hard", q:"What is imbalance?", options:["Price inefficiency where buyers/sellers not matched, often filled","Balance","Equal price","No imbalance"], answer:0},
  {id:196, cat:"Economics Hard", q:"What is bear trap?", options:["False breakdown making bears think downtrend continues then reversal up","Bull trap","No trap","Real bear"], answer:0},
  {id:197, cat:"Math Hard", q:"What is median of 1,3,3,6,7,8,9?", options:["3","6","4","7"], answer:1},
  {id:198, cat:"Science Hard", q:"What is the hottest planet?", options:["Mercury","Venus","Mars","Jupiter"], answer:1},
  {id:199, cat:"Geography Hard", q:"Which ocean is smallest?", options:["Arctic","Indian","Atlantic","Pacific"], answer:0},
  {id:200, cat:"History Hard", q:"What was the first capital of Kenya?", options:["Nairobi","Mombasa","Kisumu","Nakuru"], answer:1},
  {id:201, cat:"Technology Hard", q:"What does HTTPS mean?", options:["HyperText Transfer Protocol Secure","High Transfer Text Protocol System","Hyper Text Transfer Private System","No meaning"], answer:0},
  {id:202, cat:"Biology Hard", q:"What is the normal human body temperature?", options:["35C","37C","39C","40C"], answer:1},
  {id:203, cat:"Image Q", q:"What is this chart pattern? (Head and Shoulders)", options:["Bullish","Bearish reversal","Continuation","No pattern"], answer:1, image:"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Head_and_shoulders_top.png/300px-Head_and_shoulders_top.png"},
  {id:204, cat:"Trading Hard", q:"What is lot size?", options:["Volume of trade, 1 standard lot = 100,000 units","Price","Spread","Leverage"], answer:0},
  {id:205, cat:"Trading Hard", q:"What is slippage?", options:["Difference between expected price and executed price","Profit","Bonus","Spread"], answer:0},
  {id:206, cat:"Economics Hard", q:"What is recession?", options:["Significant decline in economic activity, 2 quarters negative GDP","Growth","Inflation","Deflation"], answer:0},
  {id:207, cat:"Math Hard", q:"What is 100/0?", options:["0","Infinity / Undefined","100","1"], answer:1},
  {id:208, cat:"Science Hard", q:"What is the study of mind called?", options:["Psychology","Sociology","Biology","Anthropology"], answer:0},
  {id:209, cat:"Geography Hard", q:"Which country is largest by area?", options:["China","USA","Russia","Canada"], answer:2}
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

// ===================== ADMIN PANEL - MPYA (Hakujagusa ya zamani) =====================
const ADMIN_USER = process.env.ADMIN_USERNAME || "KevinAdmin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "TrendGain@2025!";
const ADMIN_TOKEN = "trendgain_admin_secret_2025";

function checkAdmin(req,res,next){
  const token = req.headers['x-admin-token'] || req.body.adminToken;
  if(token === ADMIN_TOKEN) return next();
  return res.status(401).json({success:false, msg:"Unauthorized"});
}

// Admin Login
app.post('/api/admin/login', (req,res)=>{
  const {username, password} = req.body;
  if(username===ADMIN_USER && password===ADMIN_PASS){
    return res.json({success:true, token: ADMIN_TOKEN});
  }
  res.json({success:false, msg:"Wrong username or password"});
});

// Get All Users with full details
app.get('/api/admin/users', checkAdmin, async (req,res)=>{
  try{
    let users = [];
    try{ users = await User.find().sort({createdAt:-1}); }catch(e){ users = memUsers; }
    res.json({success:true, users});
  }catch(e){ res.json({success:false, users: memUsers}); }
});

// Get Stats
app.get('/api/admin/stats', checkAdmin, async (req,res)=>{
  try{
    let users = [];
    try{ users = await User.find(); }catch(e){ users = memUsers; }
    const total = users.length;
    const activated = users.filter(u=>u.activated).length;
    const totalUSD = users.reduce((s,u)=>s+(u.balanceUSD||0),0);
    const pendingWithdraw = users.reduce((s,u)=>s+(u.withdrawRequests?.length||0),0);
    const totalCorrect = users.reduce((s,u)=>s+(u.correct||0),0);
    res.json({success:true, total, activated, totalUSD, totalKES: totalUSD*129, pendingWithdraw, totalCorrect});
  }catch(e){ res.json({success:false}); }
});

// Update User (activate, balance, edit)
app.post('/api/admin/user/update', checkAdmin, async (req,res)=>{
  const {phone, updates} = req.body;
  try{
    let user = await findUser(phone);
    if(!user) return res.json({success:false, msg:"User not found"});
    Object.assign(user, updates);
    if(user.save) await user.save();
    res.json({success:true, msg:"Updated", user});
  }catch(e){ res.json({success:false, msg:e.message}); }
});

// Delete User
app.post('/api/admin/user/delete', checkAdmin, async (req,res)=>{
  const {phone} = req.body;
  try{
    try{ await User.deleteOne({phone}); }catch(e){}
    memUsers = memUsers.filter(u=>u.phone!==phone);
    res.json({success:true, msg:"Deleted"});
  }catch(e){ res.json({success:false}); }
});

// Get All Withdraw Requests
app.get('/api/admin/withdrawals', checkAdmin, async (req,res)=>{
  try{
    let users = [];
    try{ users = await User.find(); }catch(e){ users = memUsers; }
    let all = [];
    users.forEach(u=>{
      (u.withdrawRequests||[]).forEach((w,i)=>{
        all.push({ phone: u.phone, username: u.username, phoneFull: u.phoneFull, country: u.country, amount: w.amount, date: w.date, conversationId: w.conversationId, index: i, status: w.status||'pending' });
      });
    });
    all.sort((a,b)=> new Date(b.date) - new Date(a.date));
    res.json({success:true, withdrawals: all});
  }catch(e){ res.json({success:false}); }
});

// Approve Withdraw - triggers real B2C if keys exist
app.post('/api/admin/withdrawals/approve', checkAdmin, async (req,res)=>{
  const {phone, index} = req.body;
  try{
    let user = await findUser(phone);
    if(!user) return res.json({success:false, msg:"User not found"});
    let reqItem = user.withdrawRequests[index];
    if(!reqItem) return res.json({success:false, msg:"Request not found"});
    
    // Mark approved and do B2C if possible
    if(process.env.DARAJA_CONSUMER_KEY && reqItem.amount){
      try{
        const token = await getDarajaToken();
        const env = process.env.DARAJA_ENV || 'sandbox';
        const url = env === 'sandbox' ? 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest' : 'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest';
        const payload = {
          InitiatorName: process.env.DARAJA_B2C_INITIATOR || 'apitest',
          SecurityCredential: process.env.DARAJA_B2C_SECURITY_CREDENTIAL,
          CommandID: "BusinessPayment",
          Amount: reqItem.amount,
          PartyA: process.env.DARAJA_B2C_SHORTCODE || process.env.DARAJA_SHORTCODE,
          PartyB: formatPhoneDaraja(user.phoneFull || phone),
          Remarks: `TRENDGAIN Approved ${reqItem.amount}`,
          QueueTimeOutURL: process.env.DARAJA_B2C_QUEUE_TIMEOUT,
          ResultURL: process.env.DARAJA_B2C_RESULT_URL,
          Occasion: "TrendGain Approved"
        };
        const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
        reqItem.status = 'approved_sent';
        reqItem.approvedAt = new Date();
        reqItem.b2cResponse = r.data;
      }catch(err){
        reqItem.status = 'approved_pending_b2c_failed';
        reqItem.error = err.response?.data || err.message;
      }
    } else {
      reqItem.status = 'approved_simulated';
      reqItem.approvedAt = new Date();
      user.balanceUSD = 0;
      user.correct = 0;
    }
    if(user.save) await user.save();
    res.json({success:true, msg:"Approved", request: reqItem});
  }catch(e){ res.json({success:false, msg:e.message}); }
});

// Reject Withdraw
app.post('/api/admin/withdrawals/reject', checkAdmin, async (req,res)=>{
  const {phone, index} = req.body;
  try{
    let user = await findUser(phone);
    if(!user) return res.json({success:false});
    user.withdrawRequests[index].status = 'rejected';
    if(user.save) await user.save();
    res.json({success:true});
  }catch(e){ res.json({success:false}); }
});

app.listen(process.env.PORT||3000, ()=>console.log('🚀 Server running with Daraja M-Pesa STK + B2C - 210 Questions'));