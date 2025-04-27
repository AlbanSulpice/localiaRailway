// server.js
const express = require('express');
const app = express();
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const saltRounds = 10;
require('dotenv').config();

const db = require('./config/db'); // Connexion MySQL
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'https://localiarailway-production-5684.up.railway.app'
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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'secretkey',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 // 1 jour
  }
}));

// Servir les fichiers HTML statiques depuis dev-front
app.use(express.static(path.join(__dirname, '../dev-front')));

// Routes HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../dev-front/accueil.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../dev-front/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../dev-front/register.html'));
});

// API : Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Champs manquants' });
  }

  const sql = 'SELECT * FROM Client WHERE email = ?';
  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.error('Erreur MySQL :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur' });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: 'Email non trouvé ❌' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Mot de passe incorrect ❌' });
    }

    // Stocker l'utilisateur dans la session
    req.session.user = {
      id: user.id_client,
      username: user.username,
      role: user.role
    };

    res.json({ success: true, message: 'Connexion réussie ✅' });
  });
});

// API : Register
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Champs requis manquants' });
  }

  const checkEmailSQL = 'SELECT * FROM Client WHERE email = ?';
  db.query(checkEmailSQL, [email], async (err, result) => {
    if (err) return res.status(500).json({ success: false, message: 'Erreur serveur' });

    if (result.length > 0) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const insertSQL = 'INSERT INTO Client (username, password, email, role) VALUES (?, ?, ?, ?)';
      db.query(insertSQL, [username, hashedPassword, email, 'client'], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription' });

        res.status(201).json({ success: true, message: 'Inscription réussie ✅' });
      });
    } catch (hashErr) {
      console.error('Erreur hash bcrypt :', hashErr);
      res.status(500).json({ success: false, message: 'Erreur de sécurité interne' });
    }
  });
});

// API : Déconnexion
app.get('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Erreur lors de la déconnexion' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Déconnecté avec succès' });
  });
});

// API : Utilisateur connecté ?
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ connected: true, user: req.session.user });
  } else {
    res.json({ connected: false });
  }
});
// API : Récupérer tous les produits
app.get('/api/products', (req, res) => {
  const sql = 'SELECT * FROM product';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Erreur lors de la récupération des produits :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
    res.json({ success: true, products: results });
  });
});

// API : Ajouter un produit au panier
app.post('/api/panier', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Vous n\'êtes pas connecté à un compte client.' });
  }

  const { id_produit } = req.body;
  const id_client = req.session.user.id;

  if (!id_produit) {
    return res.status(400).json({ success: false, message: 'ID produit manquant.' });
  }

  // 1. Récupérer l'id_panier
  const sqlPanier = 'SELECT id_panier FROM panier WHERE id_client = ?';
  db.query(sqlPanier, [id_client], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Impossible de récupérer le panier client.' });
    }

    const id_panier = rows[0].id_panier;

    // 2. Vérifier si l'article existe déjà dans le panier
    const checkSQL = 'SELECT quantity FROM has WHERE id_panier = ? AND id_produit = ?';
    db.query(checkSQL, [id_panier, id_produit], (err, result) => {
      if (err) return res.status(500).json({ success: false, message: 'Erreur serveur (vérification).' });

      if (result.length > 0) {
        // 3. Si oui → on met à jour la quantité
        const updateSQL = 'UPDATE has SET quantity = quantity + 1 WHERE id_panier = ? AND id_produit = ?';
        db.query(updateSQL, [id_panier, id_produit], (err) => {
          if (err) return res.status(500).json({ success: false, message: 'Erreur mise à jour quantité.' });
          return res.json({ success: true, message: 'Quantité augmentée dans le panier.' });
        });
      } else {
        // 4. Sinon → on insère une nouvelle ligne
        const insertSQL = 'INSERT INTO has (id_panier, id_produit, quantity) VALUES (?, ?, 1)';
        db.query(insertSQL, [id_panier, id_produit], (err) => {
          if (err) return res.status(500).json({ success: false, message: 'Erreur ajout au panier.' });
          return res.json({ success: true, message: 'Produit ajouté au panier.' });
        });
      }
    });
  });
});

// API : Contenu du panier du client connecté
app.get('/api/panier', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Non connecté' });
  }

  const id_client = req.session.user.id;

  // Récupérer l'id_panier du client
  const sqlPanier = 'SELECT id_panier FROM panier WHERE id_client = ?';
  db.query(sqlPanier, [id_client], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Panier introuvable.' });
    }

    const id_panier = rows[0].id_panier;

    // Requête JOIN pour récupérer les produits dans le panier
    const sqlContenu = `
      SELECT p.id_produit, p.product_name, p.product_description, p.product_type, p.price, h.quantity
      FROM has h
      JOIN product p ON h.id_produit = p.id_produit
      WHERE h.id_panier = ?
    `;

    db.query(sqlContenu, [id_panier], (err, result) => {
      if (err) {
        console.error('Erreur récupération panier :', err);
        return res.status(500).json({ success: false, message: 'Erreur lecture du panier' });
      }

      res.json({ success: true, produits: result });
    });
  });
});
// API : Supprimer un produit du panier
app.delete('/api/panier/:id_produit', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Non connecté' });
  }

  const id_client = req.session.user.id;
  const id_produit = req.params.id_produit;

  // Récupérer le panier du client
  const sqlPanier = 'SELECT id_panier FROM panier WHERE id_client = ?';
  db.query(sqlPanier, [id_client], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Panier introuvable.' });
    }

    const id_panier = rows[0].id_panier;

    // Supprimer l'entrée correspondante dans la table has
    const sqlDelete = 'DELETE FROM has WHERE id_panier = ? AND id_produit = ?';
    db.query(sqlDelete, [id_panier, id_produit], (err, result) => {
      if (err) {
        console.error('Erreur suppression panier :', err);
        return res.status(500).json({ success: false, message: 'Erreur lors de la suppression.' });
      }

      res.json({ success: true, message: 'Produit supprimé du panier.' });
    });
  });
});
app.post('/api/commande', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Vous devez être connecté.' });
  }

  const id_client = req.session.user.id;

  // 1. Trouver le panier du client
  const sqlGetPanier = 'SELECT id_panier FROM panier WHERE id_client = ?';
  db.query(sqlGetPanier, [id_client], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Panier introuvable.' });
    }

    const id_panier = rows[0].id_panier;

    // 2. Récupérer les produits du panier
    const sqlGetProduits = 'SELECT * FROM has WHERE id_panier = ?';
    db.query(sqlGetProduits, [id_panier], (err, produits) => {
      if (err || produits.length === 0) {
        return res.status(400).json({ success: false, message: 'Aucun produit dans le panier.' });
      }

      // 3. Créer une commande
      const sqlCommande = 'INSERT INTO commande (Order_date, Status, id_client, id_panier) VALUES (NOW(), "en attente", ?, ?)';
      db.query(sqlCommande, [id_client, id_panier], (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Erreur lors de la création de la commande.' });
        }

        const id_commande = result.insertId;

        // 4. Aller chercher les prix des produits
        const idsProduits = produits.map(p => p.id_produit);
        const sqlPrix = `SELECT id_produit, price FROM product WHERE id_produit IN (${idsProduits.map(() => '?').join(',')})`;

        db.query(sqlPrix, idsProduits, (err, prixResult) => {
          if (err) {
            return res.status(500).json({ success: false, message: 'Erreur récupération prix.' });
          }

          // Associer prix à chaque ligne du panier
          const prixMap = {};
          prixResult.forEach(p => prixMap[p.id_produit] = p.price);

          const valeurs = produits.map(p => [
            id_commande,
            p.id_produit,
            p.quantity,
            prixMap[p.id_produit] || 0
          ]);

          const sqlInvolves = 'INSERT INTO involves (id_commande, id_produit, quantity, price) VALUES ?';
          db.query(sqlInvolves, [valeurs], (err) => {
            if (err) {
              return res.status(500).json({ success: false, message: 'Erreur lors de l’ajout des produits à la commande.' });
            }

            // 5. Vider le panier
            const sqlViderPanier = 'DELETE FROM has WHERE id_panier = ?';
            db.query(sqlViderPanier, [id_panier], (err) => {
              if (err) {
                return res.status(500).json({ success: false, message: 'Commande validée, mais erreur lors du vidage du panier.' });
              }

              res.json({ success: true, message: 'Commande validée avec succès ✅' });
            });
          });
        });
      });
    });
  });
});

// API : Récupérer l'historique des commandes du client connecté
app.get('/api/commandes', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Vous devez être connecté.' });
  }

  const id_client = req.session.user.id;

  // Requête : commandes + produits liés
  const sql = `
    SELECT c.id_commande, c.Order_date, c.Status,
           p.product_name, i.quantity, i.price
    FROM commande c
    JOIN involves i ON c.id_commande = i.id_commande
    JOIN product p ON i.id_produit = p.id_produit
    WHERE c.id_client = ?
    ORDER BY c.Order_date DESC
  `;

  db.query(sql, [id_client], (err, results) => {
    if (err) {
      console.error('Erreur récupération commandes :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    // Regrouper par commande
    const commandes = {};
    results.forEach(row => {
      const id = row.id_commande;
      if (!commandes[id]) {
        commandes[id] = {
          id_commande: id,
          date: row.Order_date,
          status: row.Status,
          produits: [],
          total: 0
        };
      }

      const totalProduit = row.quantity * row.price;
      commandes[id].produits.push({
        nom: row.product_name,
        quantity: row.quantity,
        prix: row.price,
        total: totalProduit
      });

      commandes[id].total += totalProduit;
    });

    res.json({ success: true, commandes: Object.values(commandes) });
  });
});
app.post('/api/commande/:id/valider', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Non connecté' });
  }

  const id_client = req.session.user.id;
  const id_commande = req.params.id;

  // Vérifier que la commande appartient bien à ce client et est en attente
  const checkSQL = `SELECT * FROM commande WHERE id_commande = ? AND id_client = ? AND Status = 'en attente'`;
  db.query(checkSQL, [id_commande, id_client], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Erreur lors de la vérification de la commande.' });
    }

    if (rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Commande introuvable ou déjà finalisée.' });
    }

    // Mettre à jour le statut
    const updateSQL = `UPDATE commande SET Status = 'validée' WHERE id_commande = ?`;
    db.query(updateSQL, [id_commande], (err) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de la commande.' });
      }

      res.json({ success: true, message: 'Commande validée avec succès ✅' });
    });
  });
});
// API : Passer en mode admin
app.post('/api/admin-mode', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Non connecté.' });
  }

  const id_client = req.session.user.id;
  const { code } = req.body;

  // Vérifier le code secret
  if (code !== 'localiaAdmin') {
    return res.status(403).json({ success: false, message: 'Code incorrect.' });
  }

  // Mettre à jour le rôle du client
  const sql = `UPDATE client SET role = 'admin' WHERE id_client = ?`;
  db.query(sql, [id_client], (err) => {
    if (err) {
      console.error('Erreur lors du passage en admin :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    // Mettre à jour la session aussi !
    req.session.user.role = 'admin';

    res.json({ success: true, message: 'Vous êtes maintenant en mode admin ✅' });
  });
});
// Ajouter un produit (admin)
app.post('/api/admin/product', (req, res) => {
  const { product_name, product_description, product_type, price, stock } = req.body;

  // Vérifications de base
  if (!product_name || !product_description || !product_type || price == null || stock == null) {
    return res.status(400).json({ success: false, message: 'Tous les champs doivent être remplis.' });
  }

  if (price < 0 || stock < 0) {
    return res.status(400).json({ success: false, message: 'Le prix et le stock doivent être positifs.' });
  }

  // Vérification du type
  const allowedTypes = ['textile', 'decor', 'furniture'];
  if (!allowedTypes.includes(product_type)) {
    return res.status(400).json({ success: false, message: 'Type de produit invalide.' });
  }

  // Insertion dans 'product'
  const sqlProduct = `INSERT INTO product (product_name, product_description, product_type, price) VALUES (?, ?, ?, ?)`;
  db.query(sqlProduct, [product_name, product_description, product_type, price], (err, result) => {
    if (err) {
      console.error('Erreur lors de l\'insertion du produit :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'ajout du produit.' });
    }

    const newProductId = result.insertId; // Récupérer l'id_produit inséré

    // Insertion du stock initial dans 'inventory'
    const sqlInventory = `INSERT INTO inventory (id_produit, stock) VALUES (?, ?)`;
    db.query(sqlInventory, [newProductId, stock], (err2) => {
      if (err2) {
        console.error('Erreur lors de l\'insertion du stock :', err2);
        return res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'ajout du stock.' });
      }

      res.json({ success: true, message: 'Produit ajouté avec succès ✅' });
    });
  });
});
// Modifier un produit (admin)
app.put('/api/admin/product/:id', (req, res) => {
  const { id } = req.params;
  const { product_name, product_description, product_type, price } = req.body;

  // Vérifications
  if (!id) {
    return res.status(400).json({ success: false, message: 'ID produit manquant.' });
  }

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
      return res.status(400).json({ success: false, message: 'Type de produit invalide.' });
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
      console.error('Erreur lors de la modification du produit :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur lors de la modification.' });
    }

    res.json({ success: true, message: 'Produit modifié avec succès ✅' });
  });
});
// Augmenter le stock d'un produit (admin)
app.put('/api/admin/stock/:id', (req, res) => {
  const { id } = req.params;
  const { quantite } = req.body;

  if (!id || quantite == null) {
    return res.status(400).json({ success: false, message: 'ID produit ou quantité manquante.' });
  }

  if (quantite <= 0) {
    return res.status(400).json({ success: false, message: 'La quantité à ajouter doit être positive.' });
  }

  const sql = `UPDATE inventory SET stock = stock + ? WHERE id_produit = ?`;
  db.query(sql, [quantite, id], (err, result) => {
    if (err) {
      console.error('Erreur lors de l\'augmentation du stock :', err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Produit introuvable.' });
    }

    res.json({ success: true, message: 'Stock augmenté avec succès ✅' });
  });
});
// Supprimer un produit (admin) sécurisé
app.delete('/api/admin/product/:id', (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ success: false, message: 'ID produit manquant.' });
  }

  // 1. Vérifier s'il existe dans involves
  const sqlCheckInvolves = `SELECT * FROM involves WHERE id_produit = ? LIMIT 1`;
  db.query(sqlCheckInvolves, [id], (errCheck, rows) => {
    if (errCheck) {
      console.error('Erreur lors de la vérification dans involves :', errCheck);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }

    if (rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Impossible de supprimer : produit lié à des commandes existantes.' });
    }

    // 2. Supprimer dans has (panier)
    const sqlDeleteHas = `DELETE FROM has WHERE id_produit = ?`;
    db.query(sqlDeleteHas, [id], (err1) => {
      if (err1) {
        console.error('Erreur suppression dans has :', err1);
        return res.status(500).json({ success: false, message: 'Erreur serveur.' });
      }

      // 3. Supprimer dans inventory
      const sqlDeleteInventory = `DELETE FROM inventory WHERE id_produit = ?`;
      db.query(sqlDeleteInventory, [id], (err2) => {
        if (err2) {
          console.error('Erreur suppression dans inventory :', err2);
          return res.status(500).json({ success: false, message: 'Erreur serveur.' });
        }

        // 4. Supprimer dans product
        const sqlDeleteProduct = `DELETE FROM product WHERE id_produit = ?`;
        db.query(sqlDeleteProduct, [id], (err3, result) => {
          if (err3) {
            console.error('Erreur suppression dans product :', err3);
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

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
