const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const dotenv = require('dotenv');
const session = require('express-session');
const path = require('path');

dotenv.config();
const app = express();
const db = require('./config/db');

const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'http://localhost:3000',
  'https://localiarailway-production-5684.up.railway.app' // <-- Mets ici l'URL exacte de ton Railway
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(session({
  secret: 'localiaSecret',
  resave: false,
  saveUninitialized: false,
}));

// Servir les fichiers statiques du frontend
app.use(express.static(path.join(__dirname, 'dev-front')));

// Route racine -> accueil.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dev-front', 'accueil.html'));
});

// Authentification
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Tous les champs doivent être remplis.' });
  }

  const sql = `INSERT INTO client (name, email, password, role) VALUES (?, ?, ?, 'client')`;
  db.query(sql, [name, email, password], (err, result) => {
    if (err) {
      console.error('Erreur MySQL :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
    res.json({ success: true, message: 'Inscription réussie.' });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const sql = `SELECT * FROM client WHERE email = ? AND password = ?`;
  db.query(sql, [email, password], (err, results) => {
    if (err) {
      console.error('Erreur MySQL :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides.' });
    }

    const user = results[0];
    req.session.user = { id: user.id_client, role: user.role };
    res.json({ success: true, message: 'Connexion réussie.', user: { id: user.id_client, role: user.role } });
  });
});

app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ connected: true, user: req.session.user });
  } else {
    res.json({ connected: false });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Déconnexion réussie.' });
});

// Admin - Passer en mode admin
app.post('/api/admin-mode', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Non connecté.' });
  }

  const id_client = req.session.user.id;
  const { code } = req.body;

  if (code !== 'localiaAdmin') {
    return res.status(403).json({ success: false, message: 'Code incorrect.' });
  }

  const sql = `UPDATE client SET role = 'admin' WHERE id_client = ?`;
  db.query(sql, [id_client], (err) => {
    if (err) {
      console.error('Erreur lors du passage en admin :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    req.session.user.role = 'admin';
    res.json({ success: true, message: 'Vous êtes maintenant en mode admin ✅' });
  });
});

// Admin - Ajouter un produit
app.post('/api/admin/product', (req, res) => {
  const { product_name, product_description, product_type, price, stock } = req.body;

  if (!product_name || !product_description || !product_type || price == null || stock == null) {
    return res.status(400).json({ success: false, message: 'Tous les champs doivent être remplis.' });
  }

  if (price < 0 || stock < 0) {
    return res.status(400).json({ success: false, message: 'Le prix et le stock doivent être positifs.' });
  }

  const allowedTypes = ['textile', 'decor', 'furniture'];
  if (!allowedTypes.includes(product_type)) {
    return res.status(400).json({ success: false, message: 'Type de produit invalide.' });
  }

  const sqlProduct = `INSERT INTO product (product_name, product_description, product_type, price) VALUES (?, ?, ?, ?)`;
  db.query(sqlProduct, [product_name, product_description, product_type, price], (err, result) => {
    if (err) {
      console.error('Erreur produit :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    const newProductId = result.insertId;

    const sqlInventory = `INSERT INTO inventory (id_produit, stock) VALUES (?, ?)`;
    db.query(sqlInventory, [newProductId, stock], (err2) => {
      if (err2) {
        console.error('Erreur stock :', err2);
        return res.status(500).json({ success: false, message: 'Erreur serveur.' });
      }

      res.json({ success: true, message: 'Produit ajouté avec succès ✅' });
    });
  });
});

// Admin - Modifier un produit
app.put('/api/admin/product/:id', (req, res) => {
  const { id } = req.params;
  const { product_name, product_description, product_type, price } = req.body;

  const updates = [];
  const values = [];

  if (product_name) {
    updates.push('product_name = ?');
    values.push(product_name);
  }
  if (product_description) {
    updates.push('product_description = ?');
    values.push(product_description);
  }
  if (product_type) {
    const allowedTypes = ['textile', 'decor', 'furniture'];
    if (!allowedTypes.includes(product_type)) {
      return res.status(400).json({ success: false, message: 'Type invalide.' });
    }
    updates.push('product_type = ?');
    values.push(product_type);
  }
  if (price != null) {
    if (price < 0) {
      return res.status(400).json({ success: false, message: 'Prix invalide.' });
    }
    updates.push('price = ?');
    values.push(price);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour.' });
  }

  const sql = `UPDATE product SET ${updates.join(', ')} WHERE id_produit = ?`;
  values.push(id);

  db.query(sql, values, (err) => {
    if (err) {
      console.error('Erreur modification produit :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    res.json({ success: true, message: 'Produit modifié avec succès ✅' });
  });
});

// Admin - Augmenter stock
app.put('/api/admin/stock/:id', (req, res) => {
  const { id } = req.params;
  const { quantite } = req.body;

  if (!id || quantite == null) {
    return res.status(400).json({ success: false, message: 'Données manquantes.' });
  }

  if (quantite <= 0) {
    return res.status(400).json({ success: false, message: 'Quantité invalide.' });
  }

  const sql = `UPDATE inventory SET stock = stock + ? WHERE id_produit = ?`;
  db.query(sql, [quantite, id], (err, result) => {
    if (err) {
      console.error('Erreur augmentation stock :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    res.json({ success: true, message: 'Stock augmenté avec succès ✅' });
  });
});

// Admin - Supprimer un produit (sécurisé)
app.delete('/api/admin/product/:id', (req, res) => {
  const { id } = req.params;

  const sqlCheck = `SELECT * FROM involves WHERE id_produit = ? LIMIT 1`;
  db.query(sqlCheck, [id], (err, rows) => {
    if (err) {
      console.error('Erreur vérif involves :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    if (rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Impossible : produit lié à des commandes.' });
    }

    const sqlDeleteHas = `DELETE FROM has WHERE id_produit = ?`;
    db.query(sqlDeleteHas, [id], (err1) => {
      if (err1) {
        console.error('Erreur suppression has :', err1);
        return res.status(500).json({ success: false, message: 'Erreur serveur.' });
      }

      const sqlDeleteInventory = `DELETE FROM inventory WHERE id_produit = ?`;
      db.query(sqlDeleteInventory, [id], (err2) => {
        if (err2) {
          console.error('Erreur suppression inventory :', err2);
          return res.status(500).json({ success: false, message: 'Erreur serveur.' });
        }

        const sqlDeleteProduct = `DELETE FROM product WHERE id_produit = ?`;
        db.query(sqlDeleteProduct, [id], (err3, result) => {
          if (err3) {
            console.error('Erreur suppression produit :', err3);
            return res.status(500).json({ success: false, message: 'Erreur serveur.' });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Produit introuvable.' });
          }

          res.json({ success: true, message: 'Produit supprimé avec succès ✅' });
        });
      });
    });
  });
});

// Lancement du serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
