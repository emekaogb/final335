/* Name: Language Learning App Web Server
 * Author: Emeka Ogbuachi
 * Date: 12/01/2023
 */

// dependencies
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config({ path: __dirname + '/server.env' });
const { MongoClient } = require('mongodb');
const session = require('express-session');

// Translatte API
const translatte = require('translatte');

//initialize app and MongoDB info
const app = express();
const username = process.env.MONGO_DB_USERNAME;
const password = process.env.MONGO_DB_PASSWORD;
const dbName = process.env.MONGO_DB_NAME;
const portNumber = 4000;

//initialize words JSON File
const jsonData = fs.readFileSync('words.json', 'utf-8');
const words = JSON.parse(jsonData);

// read in node server.js
if (process.argv.length != 2) {
    process.stdout.write(`Usage server.js`);
    process.exit(1);
}

// connect to the MongoDB cluster
const uri = `mongodb+srv://${username}:${password}@cluster0.nxsauzb.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);
async function run() {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    app.use(express.static('public'));
    app.listen(portNumber);
}
run().catch(console.dir);

// initialize session storage using express
app.use(session({
  secret: 'xoxogossipgirl',
  resave: false,
  saveUninitialized: true
}));
// initialize body parser and ejs template viewing
app.use(bodyParser.urlencoded({ extended: true }));
app.set("views", path.resolve(__dirname, "templates"));
app.set('view engine', 'ejs');

// get home page
app.get("/", (req, res) => {
  req.session.display = "";
  res.render('index');
});
// get signup page
app.get("/signup", (req, res) => {
  res.render('signup');
});

// get select if already logged in
app.get("/select", (req, res) => {
  if(!req.session.username){
    return res.status(404).send('Must sign in')
  }
  res.render('select', {login: new Date().toLocaleDateString(), firstname: req.session.name});
});
// post select after logging in
app.post("/select", async (req, res) => {
  const collection = client.db(dbName).collection('users');
  const data = await collection.findOne({ username: req.body.username });
  req.session.username = req.body.username; // store username in session storage
  req.session.display = "";

  if(req.body.firstname) { // for users signing up
    if(data) {
      return res.status(404).send('User already exists'); // doesn't sign up if user already exist
    } 
    const signUpData = {
      username: req.body.username,
      firstname: req.body.firstname,
      loginDate: new Date().toLocaleDateString(),
    }
    req.session.name = req.body.firstname;
    const result = await collection.insertOne(signUpData); // signs up
    res.render('select', {login: signUpData.loginDate, username: req.body.username, firstname: req.body.firstname});
  } else {
    try {
      if(!data){
          return res.status(404).send('User not found'); // if user tried to log in but account doesn't exist
      }
      const lastLogin = data.loginDate;
      req.session.name = data.firstname;
      const result = await collection.updateOne({ username: req.session.username }, { $set: {loginDate: new Date().toLocaleDateString()} });
      res.render('select', {login: lastLogin, username: data.username, firstname: data.firstname});
    } catch (error) {
        return res.status(500).send('Internal Server Error');
    }
  } 
});

// post language after selecting a language on the /select page
app.post("/language", async (req, res) => {
  let language = req.body.french ? 'French' : req.body.spanish ? 'Spanish' : req.body.italian ? 'Italian' :
  req.body.japanese ? 'Japanese' : req.body.korean ? 'Korean' : req.body.hindi ? 'Hindi' :
  req.body.swahili ? 'Swahili' : req.body.igbo ? 'Igbo' : req.body.zulu ? 'Zulu' :
  null;
 
  res.redirect(`/language/${language}`); // go to designated lang page
});

// post leaderboard for specific language
app.post("/leaderboard/:lang", async (req, res) => {
  const collection = client.db(dbName).collection(req.params.lang);
  const data = await collection.find({ points: {$gt: 0}}).sort({ points: -1 }).limit(10).toArray(); // get top 10

  if(!data){
    return res.status(404).send('Users not found'); // if no users have started the language
  }

  let i = 1;
  let table = '<table border="1">';
  table += '<tr><th>Rank</th><th>Name</th><th>Words</th></tr>';
  data.forEach(user => {
      if(user.username === req.session.username) { // highlight current user's place on the leaderboard if they are present
        table += `<tr class="currentUser"><td>${i}</td><td>${user.firstname}</td><td>${user.points}</td></tr>`; i++;
      } else {
        table += `<tr><td>${i}</td><td>${user.firstname}</td><td>${user.points}</td></tr>`; i++;
      }
  });
  table += '</table>';

  res.render('leaderboard', {language: req.params.lang, username: req.session.username, board: table});
});

// get language/:lang for after selecting a language or after validating an answer
app.get("/language/:lang", async (req, res) => {
  const lang = req.params.lang;
  const collection = client.db(dbName).collection(lang);
  const data = await collection.findOne({ username: req.session.username });
  const randomIndex = Math.floor(Math.random() * words[`${lang}`].length); // get random word in a language
  req.session.word = words[lang][randomIndex];

  const translation = await translateWord(req.session.word, lang);
  let hint;
  try {
    const dictionary = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${translation}`); 
    hint = dictionary.data[0].meanings[0].definitions[0].definition; // getting definition for hint using freeDictionaryAPI
  } catch (error) {
    hint = "couldn't find hint";
  }

  if(!data) { // if user hasn't started this language, add them to the language collection
    const userData = await client.db(dbName).collection('users').findOne({ username: req.session.username});
    const newData = {
      username: userData.username,
      firstname: userData.firstname,
      points: 0,
    };
    const result = await collection.insertOne(newData); 
    res.render('learning', { ...newData, name: req.session.name, word: req.session.word, display: "", hint: hint, language: lang, level: 'Beginner'});
  } else { // if user is coming back to this language, retrieve their previous data
    const commonData = {
      username: data.username,
      name: data.firstname,
      points: data.points,
      word: req.session.word,
      hint: hint,
      language: lang,
      display: req.session.display,
    };
    if(data.points <= 10) {
      res.render('learning', {...commonData, level: 'Beginner'});
    } else if(data.points <= 25) {
      res.render('learning', {...commonData, level: 'Intermediate'});
    } else if(data.points <= 50) {
      res.render('learning', {...commonData, level: 'Advanced'});
    } else {
      res.render('learning', {...commonData, level: 'Professional'})
    }
  }
});

// translate word from given language to english
async function translateWord(input, lang) {
  let ln = (lang === 'French') ? 'fr' : (lang === 'Spanish') ? 'es' : (lang === 'Italian') ? 'it' : 
  (lang === 'Japanese') ? 'ja' : (lang === 'Hindi') ? 'hi' : (lang === 'Korean') ? 'ko' :
  (lang === 'Igbo') ? 'ig' : (lang === 'Swahili') ? 'sw' : (lang === 'Zulu') ? 'zu' :
  null;

  const output = await translatte(input, {from: ln, to:'en'}); 
  return output.text;
}

app.post("/language/:lang", async (req, res) => { // validates answer's correctness and returns the result
  const lang = req.params.lang;
  const collection = client.db(dbName).collection(lang);
  const correctAnswer = await translateWord(req.session.word, lang); // use Translatte API to translate from language to English

  const answer = req.body.answer;
  if(!answer){ // if no answer submitted, ask to enter a response
    req.session.display = "Please enter a response";
    req.session.display += `<br>Correct answer was <span style="color: black">${correctAnswer.toLowerCase()}</span> (${req.session.word})`;
    res.redirect(`/language/${lang}`);
    return;
  }

  if(answer.toLowerCase() === correctAnswer.toLowerCase()) { // if answer is correct, increase points by 1
      req.session.display = "";
      const result = await collection.updateOne({ username: req.session.username }, { $inc: {points: 1}});
  } else { // otherwise, display the correct answer and the next word
      req.session.display = `Correct answer was <span style="color: black">${correctAnswer.toLowerCase()}</span> (${req.session.word})`;
  }
  
  res.redirect(`/language/${lang}`);
});

// command line read-in
process.stdin.setEncoding("utf8");
const prompt = `Web server started and running at http://localhost:${portNumber}\nStop to shutdown the server: `;
process.stdout.write(prompt);
process.stdin.on("readable", function () {
  let dataInput = process.stdin.read();
  if (dataInput !== null) {
    let command = dataInput.trim();
    if (command === "stop") {
        client.close();
      process.stdout.write("Shutting down the server\n");
      process.exit(0);
    } else {
      process.stdout.write("Invalid command: " + command + "\n");
    }
    process.stdout.write(prompt);
    process.stdin.resume();
  }
});