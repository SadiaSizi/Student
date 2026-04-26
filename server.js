const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const {v4: uuidv4}= require('uuid');
const transporter = require('./email');
const app = express();

app.use(express.json());
app.use(cors());

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '12345sizi',
    database: 'fixmate_db'
});

db.connect(err => {
    if (err) {
        console.error("Database connection failed:", err);
    } else {
        console.log("Connected to MySQL Database");
    }
});

app.post('/api/register', async (req, res) => {
    const { full_name, email, password, role } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const token = uuidv4();

        const sql = `
            INSERT INTO pending_users (full_name, email, password, role, verification_token)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(sql, [full_name, email, hashedPassword, role, token], err => {
            if (err) {
                return res.status(500).json({ error: "Registration failed" });
            }
            const verifyLink = `http://localhost:3000/api/verify-email/${token}`;

            transporter.sendMail({
                to: email,
                subject: 'Verify your FixMate Account',
                html: `
                    <h2>FixMate Email Verification</h2>
                    <p>Click the link below to verify your email:</p>
                    <a href="${verifyLink}">Verify Email</a>
                `
            });
            res.json({ message: 'Verification email sent. Please check inbox.' });
        });

    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/verify-email/:token', (req, res) => {
    const token = req.params.token;

    const findSql = "SELECT * FROM pending_users WHERE verification_token = ?";

    db.query(findSql, [token], (err, result) => {
        if (err) return res.send('Database error');

        if (result.length === 0) return res.send('Invalid or expired verification link');

        const user = result[0];

        const insertSql = "INSERT INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)";

        db.query(insertSql, [user.full_name, user.email, user.password, user.role], (err) => {
            if (err) return res.send('Verification failed');

            db.query("DELETE FROM pending_users WHERE id = ?", [user.id], (err) => {
                if (err) console.log(err);
                res.send('✅ Email verified successfully! You can now login.');
            });
        });
    });
});


app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) 
            return res.status(500).json({ error: "Database error" });
        if (results.length === 0) 
            return res.status(401).json({ error: "User not found" });

        const user = results[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) 
            return res.status(401).json({ error: "Invalid password" });

        res.json({
            message: "Login successful",
            role: user.role,
            name: user.full_name,
            userId: user.user_id 
        });
    });
});

app.get('/api/dashboard-stats', (req, res) => {
    const assetQ = "SELECT COUNT(*) AS totalAssets FROM assets";
    const techQ = "SELECT COUNT(*) AS totalTechs FROM users WHERE role='Technician'";

    db.query(assetQ, (err, assetRes) => {
        if (err) return res.status(500).json(err);

        db.query(techQ, (err, techRes) => {
            if (err) return res.status(500).json(err);

            res.json({
                totalAssets: assetRes[0].totalAssets,
                totalTechs: techRes[0].totalTechs,
                systemUptime: "98%"
            });
        });
    });
});

app.post('/api/assets', (req, res) => {
    const { asset_name, asset_type, location, description, next_maintenance } = req.body;

    const sql = `
        INSERT INTO assets
        (asset_name, asset_type, location, description, status, next_maintenance)
        VALUES (?, ?, ?, ?, 'Operational', ?)
    `;

    db.query(sql, [asset_name, asset_type, location, description, next_maintenance],
        err => {
            if (err) return res.status(500).json(err);
            res.json({ message: "Asset added successfully" });
        }
    );
});


app.get('/api/assets', (req, res) => {
    db.query("SELECT * FROM assets", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.delete('/api/assets/:id', (req, res) => {
    db.query(
        "DELETE FROM assets WHERE asset_id = ?",
        [req.params.id],
        err => {
            if (err) return res.status(500).json(err);
            res.json({ message: "Asset deleted" });
        }
    );
});


app.post("/api/approve-request", (req, res) => {
    const { request_id, asset_id, technician_name, priority, deadline } = req.body;

    const taskSql = `
        INSERT INTO maintenance_tasks(request_id, asset_id, technician_name, priority, deadline, status) VALUES (?, ?, ?, ?, ?, 'Assigned')`
        ;

    db.query(taskSql,[request_id, asset_id, technician_name, priority, deadline],(err) => {
        if (err) return res.status(500).json(err);
        db.query(
            "UPDATE maintenance_requests SET status='Approved' WHERE request_id=?",
            [request_id]
        );

        res.json({ message: "Task created & technician notified" });
    });
});

app.get('/api/technicians', (req, res) => {
    db.query(
        "SELECT full_name FROM users WHERE role='Technician'",
        (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results);
        }
    );
});

app.post('/api/submit-request', (req, res) => {
    const { asset_id, employee_id, title, description, location } = req.body;

    const sql = `
        INSERT INTO maintenance_requests 
        (asset_id, employee_id, title, description, location, status) 
        VALUES (?, ?, ?, ?, ?, 'Pending')
    `;

    db.query(sql, [asset_id, employee_id, title, description, location], err => {
        if (err) return res.status(500).json(err);
        res.json({ message: "Request submitted successfully" });
    });
});

app.get('/api/employee-requests/:userId', (req, res) => {
    const sql = `
        SELECT r.request_id, r.title, r.status, r.created_at, a.asset_name 
        FROM maintenance_requests r
        LEFT JOIN assets a ON r.asset_id = a.asset_id
        WHERE r.employee_id = ?
    `;
    
    db.query(sql, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/employee-requests', (req, res) => {
    const sql = `
        SELECT r.request_id, r.asset_id, r.title, r.location, r.created_at, u.full_name as employee_name
        FROM maintenance_requests r
        JOIN users u ON r.employee_id = u.user_id
        WHERE r.status = 'Pending'
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/assign-task', (req, res) => {
    const { request_id, asset_id, technician_name, priority, description, deadline } = req.body;
    const sql = `
        INSERT INTO maintenance_tasks (request_id, asset_id, technician_name, priority, description, deadline, status) VALUES (?, ?, ?, ?, ?, ?, 'Assigned')
    `;

    db.query(sql,
        [[request_id, asset_id, technician_name, priority, description, deadline]],
        err => {
            if (err) return res.status(500).json(err);
            res.json({ message: "Task assigned" });
        }
    );
});

app.get('/api/all-tasks', (req, res) => {
    const sql = `
        SELECT 
            t.id,
            a.asset_name,
            t.technician_name,
            t.deadline,
            t.status
        FROM maintenance_tasks t
        LEFT JOIN assets a ON t.asset_id = a.asset_id
        ORDER BY t.deadline ASC
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/tech-tasks/:techName', (req, res) => {
    const sql = `
        SELECT t.id, t.request_id, t.status, t.priority, t.deadline,
               t.description, a.asset_name, a.location
        FROM maintenance_tasks t
        LEFT JOIN assets a ON t.asset_id = a.asset_id
        WHERE t.technician_name = ?
    `;
    db.query(sql, [req.params.techName], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/update-status', (req, res) => {
    const { task_id, status } = req.body;

    db.query(
        "UPDATE maintenance_tasks SET status = ? WHERE id = ?",
        [status, task_id],
        (err) => {
            if (err) return res.status(500).json(err);

            if (status === 'Completed') {
                db.query(
                    `
                    UPDATE maintenance_requests r
                    JOIN maintenance_tasks t ON r.request_id = t.request_id
                    SET r.status = 'Approved'
                    WHERE t.id = ?
                    `,
                    [task_id]
                );
            }

            res.json({ message: "Task updated correctly" });
        }
    );
});


app.get('/api/my-requests/:userId', (req, res) => {
    const sql = `
        SELECT r.*, a.asset_name 
        FROM maintenance_requests r
        LEFT JOIN assets a ON r.asset_id = a.asset_id
        WHERE r.employee_id = ?
        ORDER BY r.created_at DESC
    `;
    db.query(sql, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

setInterval(() => {
    db.query(
        "SELECT asset_id FROM assets WHERE next_maintenance <= CURDATE()",
        (err, results) => {
            if (!results) return;

            results.forEach(asset => {
                db.query(
                    "INSERT INTO maintenance_requests(asset_id, employee_id, title, description, location, status) VALUES (?, 1, 'Preventive Maintenance', 'Auto generated maintenance', 'System', 'Pending')",
                    [asset.asset_id]
                );
            });
        }
    );
}, 86400000);


app.listen(3000, () => {
    console.log("FixMate Server running on port 3000");
});
