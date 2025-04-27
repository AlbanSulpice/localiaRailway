const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT, // <- 👈 Ajout essentiel
  user: process.env.DB_USER,
  password: process.env.DB_PASS, // <- attention : dans .env c'est DB_PASS, pas DB_PASSWORD
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('❌ Erreur de connexion à MySQL :', err);
  } else {
    console.log('✅ Connecté à la base de données MySQL');
  }
});

module.exports = db;