const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer'); // Multer import add kiya
const app = express();
const crypto = require('crypto');
const { builtinModules } = require('module');
// Multer setup (Uploads ke liye)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },

    filename: (req, file, cb) => {
        const uniqueName =
            crypto.randomBytes(16).toString('hex') +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }
});

const upload = multer({ storage });

// Database Connection
// Database Connection
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Yeh line ab har haal mein chalegi
    }
});
// Database initialize hone ke thik niche is code ko daalein
pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
`, (err, res) => {
    if (err) {
        console.error('Database tables fetch nahi ho payi ❌:', err.stack);
    } else {
        console.log('--- Aapke Database ki Tables ki List 🔥 ---');
        res.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.table_name}`);
        });
        console.log('------------------------------------------');
    }
});

// Middlewares
app.use(bodyParser.json());
app.use(express.static('public'));
// Server.js mein static folder setup ke niche add karein
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Helper Function
function getLocalDate() {
    const d = new Date();
    const tzOffset = 5.5 * 60 * 60 * 1000;
    const localTime = new Date(d.getTime() + tzOffset);
    return localTime.toISOString().split('T')[0];
}
app.get('/api/billing/medicines/:patientId', async (req, res) => {

    try {

        const patientId = req.params.patientId;

        const result = await pool.query(`
            SELECT
                pi.item_id,
                pi.medicine_name,
                pi.quantity
            FROM prescription_items pi
            INNER JOIN prescriptions p
                ON pi.rx_id = p.rx_id
            WHERE pi.rx_id = (
                SELECT rx_id
                FROM prescriptions
                WHERE patient_id = $1
                  AND appointment_date = CURRENT_DATE
                ORDER BY rx_id DESC
                LIMIT 1
            )
            AND pi.is_dispensed = true
        `, [patientId]);

        res.json({
            success: true,
            items: result.rows
        });

    } catch(err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: 'Medicine Fetch Error'
        });
    }
});
app.get('/api/admin/get-clinic-config', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT opd_charges, emergency_charges FROM clinic_config LIMIT 1'
        );
        if (result.rows.length > 0) {
            res.json({
                opd_charges: result.rows[0].opd_charges,
                emergency_charges: result.rows[0].emergency_charges
            });
        } else {
            // If no config exists, return default values
            res.json({ opd_charges: 0, emergency_charges: 0 });
        }
    } catch (err) {
        console.error('Error fetching clinic config:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/set-clinic-config
app.post('/api/admin/set-clinic-config', async (req, res) => {
    const { opd_charges, emergency_charges } = req.body;

    if (typeof opd_charges !== 'number' || typeof emergency_charges !== 'number') {
        return res.status(400).json({ success: false, message: 'Invalid input' });
    }

    try {
        // Check if a config already exists
        const result = await pool.query('SELECT * FROM clinic_config LIMIT 1');

        if (result.rows.length > 0) {
            // Update existing record
            await pool.query(
                'UPDATE clinic_config SET opd_charges = $1, emergency_charges = $2',
                [opd_charges, emergency_charges]
            );
        } else {
            // Insert new record
            await pool.query(
                'INSERT INTO clinic_config (opd_charges, emergency_charges) VALUES ($1, $2)',
                [opd_charges, emergency_charges]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating clinic config:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
// Server.js mein yeh code add karein
// =====================================================
// GET PATIENT LAB REPORTS
// =====================================================
app.get('/api/reports/patient/:patientId', async (req, res) => {
    try {
        const patientId = req.params.patientId;

        const result = await pool.query(`
            SELECT
                vital_id,
                lab_report_path,
                created_at
            FROM vitals
            WHERE patient_id = $1
              AND lab_report_path IS NOT NULL
            ORDER BY created_at DESC
        `, [patientId]);

        const reports = result.rows.map((row, index) => ({
            report_name: `Lab Report ${index + 1}`,
            file_url: '/' + row.lab_report_path.replace(/\\/g, '/')
        }));

        res.json({
            success: true,
            reports
        });

    } catch (error) {
        console.error('Lab report fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Server Error'
        });
    }
});
// =========================================================================
// --- 2. ADMIN MODULE ENDPOINTS -------------------------------------------
// =========================================================================

// A. Create New Staff Member / User Route
app.post('/api/create-user', async (req, res) => {
    const { staffName, username, password, roleId } = req.body;

    if (!staffName || !username || !password || !roleId) {
        return res.status(400).json({ message: "Sabh fields zaroori hain!" });
    }

    try {
        const userQuery = 'INSERT INTO users (staff_name, username, password_hash, role_id) VALUES ($1, $2, $3, $4) RETURNING user_id';
        const userResult = await pool.query(userQuery, [staffName, username, password, roleId]);
        const newUserId = userResult.rows[0].user_id;

        // Agar Doctor role (Role ID: 2) select kiya hai toh doctors table me link karein
        if (parseInt(roleId) === 2) {
            const doctorQuery = 'INSERT INTO doctors (user_id, specialization, room_no, on_leave) VALUES ($1, $2, $3, $4)';
            await pool.query(doctorQuery, [newUserId, 'General Physician', 'Not Set', false]);
        }

        res.status(200).json({ message: "Staff account successfully created!" });
    } catch (err) {
        console.error("Create User Error:", err);
        res.status(500).json({ message: "Database Error: " + err.message });
    }
});

// D. Delete Notice Endpoint (FIXED & FULLPROOF FOR DASHBOARD SAFETY)
app.delete('/api/admin/delete-notice/:id', async (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ success: false, message: "Valid Notice ID zaroori hai!" });
    }

    try {
        const result = await pool.query('DELETE FROM public.clinic_circulars WHERE id = $1', [parseInt(id)]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Notice database me nahi mila!" });
        }

        res.json({ success: true, message: "Notice successfully deleted!" });
    } catch (err) {
        console.error("Notice Delete Error Backend:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// B. Toggle Doctor Leave Status (FIXED: 'db is not defined' error resolved)
app.put('/api/doctors/toggle-leave/:doctorId', async (req, res) => {
    const { doctorId } = req.params;
    const { leaveStatus } = req.body; // true ya false milega frontend se

    try {
        // 'pool.query' standard reference ensures connectivity without breakdown
        const updateLeaveQuery = 'UPDATE doctors SET on_leave = $1 WHERE doctor_id = $2';
        await pool.query(updateLeaveQuery, [leaveStatus, doctorId]);

        res.status(200).json({ success: true, message: "Leave status updated successfully!" });
    } catch (err) {
        console.error("Leave Update Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/admin/add-notice', async (req, res) => {
    try {
        const { title, message, content, headline, body } = req.body; 
        
        // Dynamic fallback fallback inputs verification
        const finalTitle = title || headline || "Clinic Update";
        const finalContent = message || content || body;

        if (!finalContent || finalContent.trim() === "") {
            return res.status(400).json({ success: false, message: "Notice message content zaroori hai!" });
        }

        // NOW()::timestamp explicitly casted for compatibility with your schema
        const query = `
            INSERT INTO public.clinic_circulars (title, content, posted_date, is_active)
            VALUES ($1, $2, NOW()::timestamp, true)
            RETURNING id;
        `;
        
        const result = await pool.query(query, [finalTitle.trim(), finalContent.trim()]);
        res.json({ success: true, id: result.rows[0].id, message: "Notice successfully published!" });
    } catch (err) {
        console.error("Notice Save Error Backend:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/doctor/update-leave', async (req, res) => {
    try {
        const { doctorId, status } = req.body;
        
        // pool use karein kyunki aapne upar 'const pool = new Pool()' banaya hai
        const result = await pool.query(
            `UPDATE public.doctor_leaves SET status = $1 WHERE doctor_id = $2`,
            [status, doctorId]
        );
        
        res.json({ success: true, message: "Leave status synced successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// C. Update User Role Mapping Route
app.post('/api/admin/update-role', async (req, res) => {
    const { userId, roleId } = req.body; 
    try {
        let queryStr = `UPDATE users SET role_id = $1 WHERE username = $2`;
        if (typeof userId === 'number' || !isNaN(userId)) {
            queryStr = `UPDATE users SET role_id = $1 WHERE user_id = $2`;
        }
        await pool.query(queryStr, [parseInt(roleId), userId]);
        res.json({ success: true, message: "Role updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// D. Update Doctor Room Number Allocation
app.post('/api/update-room', async (req, res) => {
    const { doctor_id, room_no } = req.body;
    try {
        await pool.query(
            'UPDATE doctors SET room_no = $1 WHERE doctor_id = $2',
            [room_no, doctor_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// E. Fetch Active Doctors List for Dropdowns (MERGED & PERFECTED LOGIC WITH CLINIC SCHEDULE CHECK)
app.get('/api/get-active-doctors', async (req, res) => {
    try {
        const todayDate = getLocalDate();
        const currentDayIdx = new Date().getDay(); // 0 (Sunday) to 6 (Saturday)

        // 1. Check karein kya aaj pure clinic ka off-day hai schedule table se?
        // Fallback safety filter built-in in case table structure mismatch
        const scheduleCheck = await pool.query(
            "SELECT is_working FROM clinic_schedule WHERE day_idx = $1 OR day_name = TO_CHAR(NOW(), 'Day')", 
            [currentDayIdx]
        ).catch(() => ({ rows: [{ is_working: true }] })); // Failure safety bypass

        if (scheduleCheck.rows.length > 0 && !scheduleCheck.rows[0].is_working) {
            return res.status(200).json([]); // Aaj clinic band hai, koi doctor operational nahi dikhega
        }

        // 2. Sirf un doctors ko nikalen jo active hain aur jinki dynamic leave block me entry nahi h
        const queryText = `
            SELECT d.doctor_id, u.staff_name, d.specialization, d.room_no
            FROM public.doctors d
            INNER JOIN public.users u ON d.user_id = u.user_id
            WHERE u.is_locked = false 
              AND d.on_leave = false
              AND d.doctor_id NOT IN (
                  SELECT doctor_id FROM doctor_leaves 
                  WHERE $1 BETWEEN start_date AND end_date
              )
            ORDER BY u.staff_name ASC;
        `;
        const result = await pool.query(queryText, [todayDate]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching filtered doctors:", err.message);
        res.status(500).json({ error: "Database error: " + err.message });
    }
});

// F. Fetch All Doctors for Admin Dashboard/Leave Manage Module
app.get('/api/doctors', async (req, res) => {
    try {
        const queryText = `
            SELECT 
                d.doctor_id,
                u.staff_name,
                d.specialization,
                d.room_no,
                d.on_leave
            FROM public.doctors d
            INNER JOIN public.users u ON d.user_id = u.user_id
            ORDER BY u.staff_name ASC;
        `;
        const result = await pool.query(queryText);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Doctor Fetch Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// G. NEW! FIXED 'Notice Save Error' - Broadcast Notice Board Endpoint
// Fallback Route Alias
app.post('/api/admin/broadcast-notice', async (req, res) => {
    try {
        const { title, headline, message, content, body } = req.body;
        const finalTitle = title || headline || "Clinic Update";
        const finalContent = message || content || body;

        if (!finalContent || finalContent.trim() === "") {
            return res.status(400).json({ success: false, message: "Content empty!" });
        }

        const query = `
            INSERT INTO public.clinic_circulars (title, content, posted_date, is_active) 
            VALUES ($1, $2, NOW()::timestamp, true) 
            RETURNING id;
        `;
        const result = await pool.query(query, [finalTitle.trim(), finalContent.trim()]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error("Broadcast Alias Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =========================================================================
// --- 3. REGISTRATION MODULE (Patient Front Desk) ------------------------
// =========================================================================

app.post('/api/register-patient', async (req, res) => {
    const { name, age, gender, address, doctor_id, phone } = req.body;
    const client = await pool.connect();
    const todayDate = getLocalDate();

    try {
        await client.query('BEGIN');
        
        // 1. Doctor Leave Status Check
        const doctorCheck = await client.query('SELECT on_leave FROM doctors WHERE doctor_id = $1', [parseInt(doctor_id)]);
        if (doctorCheck.rows.length > 0 && doctorCheck.rows[0].on_leave) {
            throw new Error("Chuninda Doctor aaj avkaash (leave) par hain!");
        }

        // 2. Duplicate Registration Check
        const duplicateCheck = await client.query(
            `SELECT 1 FROM appointments 
             WHERE patient_id = (SELECT patient_id FROM patients WHERE phone = $1)
             AND doctor_id = $2 AND visit_date = $3 AND status = 'Waiting' LIMIT 1`,
            [phone.trim(), parseInt(doctor_id), todayDate]
        );

        if (duplicateCheck.rows.length > 0) {
            throw new Error("Patient pehle se hi is doctor ke liye Waiting queue mein hai.");
        }

        // 3. Patient Upsert Logic (Yahan se aapka code missing ho sakta tha)
        let patientId;
        const existingPatient = await client.query('SELECT patient_id FROM patients WHERE phone = $1', [phone.trim()]);

        if (existingPatient.rows.length > 0) {
            patientId = existingPatient.rows[0].patient_id;
            await client.query(`UPDATE patients SET name = $1, age = $2, gender = $3, address = $4 WHERE patient_id = $5`,
                [name, parseInt(age), gender, address, patientId]);
        } else {
            const resPatient = await client.query(`INSERT INTO patients (name, age, gender, address, phone) VALUES ($1, $2, $3, $4, $5) RETURNING patient_id`,
                [name, parseInt(age), gender, address, phone.trim()]);
            patientId = resPatient.rows[0].patient_id;
        }

        // 4. Queue Generation & Appointment Insert
        const queueRes = await client.query(`SELECT COALESCE(MAX(queue_no), 0) + 1 AS next_queue FROM appointments WHERE visit_date = $1 AND doctor_id = $2`, 
            [todayDate, parseInt(doctor_id)]);
        const nextQueueNo = queueRes.rows[0].next_queue;

        await client.query(`INSERT INTO appointments (patient_id, doctor_id, visit_date, queue_no, status) VALUES ($1, $2, $3, $4, 'Waiting')`,
            [patientId, parseInt(doctor_id), todayDate, nextQueueNo]);

        await client.query('COMMIT');
        res.json({ success: true, patient_id: patientId, queueNo: nextQueueNo });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, error: err.message }); // Frontend par alert(data.error) dikhega
    } finally {
        client.release();
    }
});
app.get('/api/registration/today-queue', async (req, res) => {
    const doctorId = req.query.doctor_id;
    const todayDate = new Date().toISOString().split('T')[0];

    try {

        let query = `
            SELECT
                a.app_id,
                a.queue_no,
                p.patient_id,
                p.age,
                p.gender,
                p.name,
                p.phone,
                a.status,
                u.staff_name AS doctor_display
            FROM appointments a
            JOIN patients p ON a.patient_id = p.patient_id
            JOIN doctors d ON a.doctor_id = d.doctor_id
            JOIN users u ON d.user_id = u.user_id
            WHERE a.visit_date = $1
            AND a.status IN ('Waiting','Booked')
        `;

        let params = [todayDate];

        if (doctorId && doctorId !== 'undefined' && doctorId !== 'null') {
            query += ` AND a.doctor_id = $2`;
            params.push(doctorId);
        }

        query += ` ORDER BY a.queue_no ASC`;

        const result = await pool.query(query, params);

        res.json({
            success: true,
            queue: result.rows
        });

    } catch (err) {
        console.error("Fetch Today Queue Error:", err);
        res.status(500).json({
            success: false,
            message: "Database Error"
        });
    }
});
app.get('/api/registration/search-patient', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false, message: "Phone number required" });

    try {
        const result = await pool.query(
            `SELECT patient_id, name, age, gender, address, phone FROM patients WHERE phone = $1`,
            [phone.trim()]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, found: true, patient: result.rows[0] });
        } else {
            res.json({ success: true, found: false });
        }
    } catch (err) {
        console.error("Search Patient Phone Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/registration/search-patient-by-id', async (req, res) => {
    const { patient_id } = req.query;
    if (!patient_id) return res.status(400).json({ success: false, message: "Patient ID required" });

    try {
        const result = await pool.query(
            `SELECT patient_id, name, age, gender, address, phone FROM patients WHERE patient_id = $1`,
            [parseInt(patient_id)]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, found: true, patient: result.rows[0] });
        } else {
            res.json({ success: true, found: false });
        }
    } catch (err) {
        console.error("Search Patient ID Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// Ye code aapki backend file (server.js/routes) mein jayega
app.get('/api/patient/history/:patient_id', async (req, res) => {
    const patientId = req.params.patient_id;

 const query = `
        SELECT
    rx_id,
    date_recorded,
    diagnosis,
    diagnostic_tests,
    medicines,
    is_sos
FROM prescriptions
WHERE patient_id = $1
ORDER BY date_recorded DESC
    `;

    try {
        const result = await pool.query(query, [patientId]);
        res.json({ success: true, history: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.get('/api/patient/:id', async (req, res) => {

    let searchId = req.params.id.replace(/[^0-9]/g, '').trim();
    const todayDate = getLocalDate();

    if (!searchId) {
        return res.status(400).json({
            success: false,
            message: "Invalid ID"
        });
    }

    try {

        // Search by Queue No for today's appointment
        const appointmentCheck = await pool.query(
`
SELECT
    a.patient_id,
    p.name,
    p.age,
    p.gender,

    COALESCE(rx.include_opd_charges,false)
        AS opd_charge_applied,

    COALESCE(rx.include_emergency_charges,false)
        AS emergency_charge_applied

FROM appointments a

JOIN patients p
    ON a.patient_id = p.patient_id

LEFT JOIN (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        include_opd_charges,
        include_emergency_charges
    FROM prescriptions
    ORDER BY patient_id, rx_id DESC
) rx
    ON rx.patient_id = p.patient_id

WHERE a.queue_no = $1
AND a.visit_date = $2
`,
[
    parseInt(searchId),
    todayDate
]
);

        console.log("Appointment Rows =>", appointmentCheck.rows);

        if (appointmentCheck.rows.length > 0) {
            return res.json(appointmentCheck.rows[0]);
        }

        // Fallback: Search directly by patient_id
        const directPatientCheck = await pool.query(
`
SELECT
    p.patient_id,
    p.name,
    p.age,
    p.gender,

    COALESCE(rx.include_opd_charges,false)
        AS opd_charge_applied,

    COALESCE(rx.include_emergency_charges,false)
        AS emergency_charge_applied

FROM patients p

LEFT JOIN (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        include_opd_charges,
        include_emergency_charges
    FROM prescriptions
    ORDER BY patient_id, rx_id DESC
) rx
    ON rx.patient_id = p.patient_id

WHERE p.patient_id = $1
`,
[
    parseInt(searchId)
]
);

        console.log("Direct Patient Rows =>", directPatientCheck.rows);

        if (directPatientCheck.rows.length > 0) {
            return res.json(directPatientCheck.rows[0]);
        }

        return res.status(404).json({
            success: false,
            message: "Patient not found"
        });

    } catch (err) {

        console.error("Patient Fetch Error:", err);

        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});
// =========================================================================
// --- 4. STAFF LOGIN MODULE ----------------------------------------------
// =========================================================================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // 1. User aur Role fetch karein (user_id ke saath)
        const user = await pool.query(
            `SELECT u.user_id, u.username, r.role_name, u.is_locked 
             FROM users u 
             JOIN roles r ON u.role_id = r.role_id 
             WHERE u.username = $1 AND u.password_hash = $2`,
            [username, password]
        );

        if (user.rows.length > 0) {
            const userData = user.rows[0];
            if (userData.is_locked) return res.status(403).json({ success: false, message: "Account Locked!" });

            let doctorId = null;

            // 2. Agar role 'Doctor' hai, toh uski 'doctor_id' dhoondein
            if (userData.role_name === 'Doctor') {
                const docRes = await pool.query("SELECT doctor_id FROM doctors WHERE user_id = $1", [userData.user_id]);
                if (docRes.rows.length > 0) {
                    doctorId = docRes.rows[0].doctor_id; // Sahi doctor_id mil gayi
                }
            }

            // 3. Response mein role aur doctor_id dono bhejenge
            res.json({ 
                success: true, 
                role: userData.role_name,
                doctor_id: doctorId 
            });
        } else {
            res.status(401).json({ success: false, message: "Invalid Credentials" });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: "Database error" });
    }
});
// =========================================================================
// --- 5. NURSING STATION MODULE (Vitals Management) ----------------------
// =========================================================================
app.post('/api/vitals/save', upload.single('lab_report'), async (req, res) => {
    try {
        const { patient_id, bp_systolic, bp_diastolic, pulse, spo2, temperature, height_cm, weight_kg, bmi } = req.body;
        
        // File path yahan se milega
        const labReportPath = req.file ? `uploads/${req.file.filename}` : null;
        console.log(req.file);
        if (!patient_id) return res.status(400).json({ success: false, message: "Patient ID missing" });

        const today = getLocalDate();

        // 1. Check duplicate
        const checkDuplicate = await pool.query(
            `SELECT vital_id FROM vitals WHERE patient_id = $1 AND created_at::date = $2`,
            [parseInt(patient_id), today]
        );

        if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Is patient ki vitals aaj pehle hi record ho chuki hain!" });
        }

        const combinedBP = `${bp_systolic || 0}/${bp_diastolic || 0}`;
        
        // 2. Query Updated (Added lab_report_path)
        const query = `
            INSERT INTO vitals (
                patient_id, bp, bp_systolic, bp_diastolic, pulse, 
                spo2, temperature, height_cm, weight, bmi, recorded_by, lab_report_path
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;

        const values = [
            parseInt(patient_id), 
            combinedBP, 
            parseInt(bp_systolic || 0), 
            parseInt(bp_diastolic || 0), 
            parseInt(pulse || 0), 
            parseInt(spo2 || 0), 
            parseFloat(temperature || 0), 
            parseInt(height_cm || 0), 
            parseFloat(weight_kg || 0), 
            parseFloat(bmi || 0), 
            'Nurse Station 1',
            labReportPath // Naya path add kiya
        ];

        await pool.query(query, values);
        res.status(200).json({ success: true, message: "Vitals & Report saved successfully!" });
        
    } catch (err) {
        console.error("DEBUG:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
app.get('/api/vitals/latest', async (req, res) => {
    const { patient_id } = req.query;
    try {
        const result = await pool.query(
            `SELECT bp_systolic, bp_diastolic, pulse, spo2, temperature, height_cm, weight, bmi 
             FROM vitals 
             WHERE patient_id = $1 
             ORDER BY vital_id DESC LIMIT 1`,
            [parseInt(patient_id)]
        );
        if(result.rows.length > 0) {
            res.json({ success: true, vitals: result.rows[0] });
        } else {
            res.json({ success: true, vitals: null });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
 //=========================================================================
// --- 6. DOCTOR CLINICAL MODULE (EMR Workbench) --------------------------
// =========================================================================
app.get('/api/doctor/waiting-list/:doctorId', async (req, res) => {

    const todayDate = getLocalDate();
    const doctorId = parseInt(req.params.doctorId);

    try {

        const result = await pool.query(
            `SELECT
                p.patient_id,
                p.name,
                a.queue_no
             FROM patients p
             INNER JOIN appointments a
                ON p.patient_id = a.patient_id
             WHERE a.status = 'Waiting'
               AND a.visit_date = $1
               AND a.doctor_id = $2
             ORDER BY a.queue_no ASC`,
            [todayDate, doctorId]
        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
app.get('/api/doctor/patient-details/:id', async (req, res) => {
    const patientId = req.params.id.replace(/[^0-9]/g, '').trim();
    try {
        const result = await pool.query(
            `SELECT p.patient_id, p.name, 
                    COALESCE(NULLIF(rx.opd_charge_amount, 'NaN'::numeric), 0) as opd_charge_amount,
                    COALESCE(NULLIF(rx.emergency_charge_amount, 'NaN'::numeric), 0) as emergency_charge_amount
             FROM patients p
             LEFT JOIN prescriptions rx ON p.patient_id = rx.patient_id
             WHERE p.patient_id = $1
             ORDER BY rx.rx_id DESC LIMIT 1`, 
            [parseInt(patientId)]
        );

        if (result.rows.length > 0) {
            res.json({ success: true, ...result.rows[0] });
        } else {
            res.status(404).json({ success: false, message: "Patient not found" });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/api/doctor/save-prescription', async (req, res) => {
    const { patient_id, doctor_id, diagnosis, diagnostic_tests, medicines, chargeCart = [] } = req.body;

    const client = await pool.connect();
    const todayDate = getLocalDate();

    try {
        await client.query('BEGIN');
        const configResult = await client.query('SELECT opd_charges, emergency_charges FROM clinic_config LIMIT 1');
        const config = configResult.rows[0] || { opd_charges: 0, emergency_charges: 0 };
        // Logic: Cart se data extract karna
        const opdItem = chargeCart.find(c => c.type === 'opd');
        const emergencyItem = chargeCart.find(c => c.type === 'emergency');

        const opd_charge_applied = !!opdItem;
        const emergency_charge_applied = !!emergencyItem;

        // Data conversion aur NaN check
        const opd_charge_amount = opd_charge_applied ? parseFloat(config.opd_charges) : 0;
const emergency_charge_amount = emergency_charge_applied ? parseFloat(config.emergency_charges) : 0;

        // Insert Prescription
        const rx = await client.query(`
            INSERT INTO prescriptions
            (patient_id, doctor_id, diagnosis, diagnostic_tests, include_opd_charges, include_emergency_charges, opd_charge_amount, emergency_charge_amount, date_recorded)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING rx_id
        `, [
            parseInt(patient_id), 
            doctor_id || 1, 
            diagnosis, 
            diagnostic_tests || null,
            opd_charge_applied, 
            emergency_charge_applied, 
            opd_charge_amount, 
            emergency_charge_amount
        ]);

        const rxId = rx.rows[0].rx_id;

        // Insert Items
        if (Array.isArray(medicines)) {
            for (let med of medicines) {
                await client.query(`
                    INSERT INTO prescription_items (rx_id, medicine_name, quantity, dosage, days)
                    VALUES ($1, $2, $3, $4, $5)`,
                    [rxId, med.medicine_name, parseInt(med.quantity) || 0, med.dosage, parseInt(med.days) || 0]
                );
            }
        }

        // Update Appointment
        await client.query(`UPDATE appointments SET status = 'Completed' WHERE patient_id = $1 AND visit_date = $2`,
            [parseInt(patient_id), todayDate]
        );

        await client.query('COMMIT');
        res.json({ success: true, rx_id: rxId });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});
// =========================================================================
// --- 7. PHARMACY AND INVENTORY MODULE -----------------------------------
// =========================================================================
app.get('/api/pharmacy/prescription/:id', async (req, res) => {
    let targetPatientId = req.params.id.replace(/[^0-9]/g, '').trim();
    if (!targetPatientId) return res.status(400).json({ success: false, message: "Valid Patient ID required" });

    try {
        const patientCheck = await pool.query(`SELECT name, age, gender FROM patients WHERE patient_id = $1`, [parseInt(targetPatientId)]);
        if (patientCheck.rows.length === 0) return res.json({ success: false, message: `Patient ID ${targetPatientId} Not Found!` });
        const pBase = patientCheck.rows[0];

        const result = await pool.query(`
            SELECT pi.item_id, pi.rx_id, pi.medicine_name, pi.quantity, pi.dosage, pi.days, pi.is_dispensed, p.patient_id, p.date_recorded, pt.name AS patient_name, pt.age, pt.gender,
                   COALESCE(u.staff_name, 'Dr. Gupta') as doctor_name
            FROM prescription_items pi
            JOIN prescriptions p ON pi.rx_id = p.rx_id
            JOIN patients pt ON p.patient_id = pt.patient_id
            LEFT JOIN doctors d ON p.doctor_id = d.doctor_id
            LEFT JOIN users u ON d.user_id = u.user_id
            WHERE p.patient_id = $1 AND pi.is_dispensed = false 
            ORDER BY pi.item_id DESC LIMIT 15`, 
            [parseInt(targetPatientId)]
        );

        if (result.rows.length > 0) {
            res.json({ 
                success: true, items: result.rows, patient_id: targetPatientId,
                patient_name: result.rows[0].patient_name, age: result.rows[0].age, gender: result.rows[0].gender,
                doctor_name: result.rows[0].doctor_name, appointment_date: result.rows[0].date_recorded
            });
        } else {
            res.json({ 
                success: true, items: [], patient_id: targetPatientId, patient_name: pBase.name, age: pBase.age, gender: pBase.gender,
                doctor_name: 'Dr. Gupta', message: "मरीज की सभी दवाएं डिस्पेंस हो चुकी हैं या कोई नया पर्चा दर्ज नहीं है!"
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Database Join Error: " + err.message });
    }
});

app.post('/api/pharmacy/dispense', async (req, res) => {
    const { medicine_name, qty_to_subtract, patient_id, item_id } = req.body;
    const client = await pool.connect();
    const todayDate = getLocalDate();
    try {
        await client.query('BEGIN');

        await client.query(`UPDATE pharmacy_stock SET current_stock = current_stock - $1 WHERE medicine_name = $2`, [parseInt(qty_to_subtract), medicine_name]);
        
        if (item_id) {
            await client.query(`UPDATE prescription_items SET is_dispensed = true WHERE item_id = $1`, [parseInt(item_id)]);
        } else {
            await client.query(`
                UPDATE prescription_items SET is_dispensed = true 
                WHERE item_id IN (
                    SELECT pi.item_id FROM prescription_items pi
                    JOIN prescriptions p ON pi.rx_id = p.rx_id
                    WHERE p.patient_id = $1 AND pi.medicine_name = $2
                )`, [parseInt(patient_id), medicine_name]);
        }

        if (patient_id) {
            const remainingCheck = await client.query(`
                SELECT pi.item_id FROM prescription_items pi
                JOIN prescriptions p ON pi.rx_id = p.rx_id
                WHERE p.patient_id = $1 AND pi.is_dispensed = false`, [parseInt(patient_id)]);
            
            if (remainingCheck.rows.length === 0) {
                await client.query(`UPDATE appointments SET status = 'Dispensed' WHERE patient_id = $1 AND visit_date = $2`, [parseInt(patient_id), todayDate]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Dispense Error:", err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/pharmacy/update-inventory', async (req, res) => {
    const { medicine_name, supplier_name, batch_no, price_per_unit, qty_ordered, qty_received } = req.body;

    if (!medicine_name || !supplier_name || !batch_no || !qty_received) {
        return res.status(400).json({ success: false, message: "कृपया सभी जरूरी फील्ड भरें!" });
    }

    const total_amount = parseFloat(price_per_unit || 0) * parseInt(qty_received);

    try {
        await pool.query(
            `INSERT INTO pharmacy_supplier_ledger 
            (medicine_name, supplier_name, batch_no, price_per_unit, qty_ordered, qty_received, total_amount) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [medicine_name.trim(), supplier_name.trim(), batch_no.trim(), parseFloat(price_per_unit), parseInt(qty_ordered || 0), parseInt(qty_received), total_amount]
        );

        const checkExist = await pool.query(
            `SELECT med_id, current_stock FROM pharmacy_stock WHERE UPPER(TRIM(medicine_name)) = UPPER(TRIM($1))`,
            [medicine_name.trim()]
        );

        if (checkExist.rows.length > 0) {
            const newStockTotal = parseInt(checkExist.rows[0].current_stock) + parseInt(qty_received);
            await pool.query(
                `UPDATE pharmacy_stock SET current_stock = $1, supplier_info = $2 WHERE med_id = $3`,
                [newStockTotal, supplier_name.trim(), checkExist.rows[0].med_id]
            );
            res.json({ success: true, message: `${medicine_name} stock updated successfully!` });
        } else {
            await pool.query(
                `INSERT INTO pharmacy_stock (medicine_name, current_stock, supplier_info) VALUES ($1, $2, $3)`,
                [medicine_name.trim(), parseInt(qty_received), supplier_name.trim()]
            );
            res.json({ success: true, message: `New medicine ${medicine_name} registered into stock!` });
        }
    } catch (err) {
        console.error("Database Sync Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/pharmacy/supplier-ledger-report', async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "तारीख आवश्यक है!" });

    try {
        const result = await pool.query(
            `SELECT ledger_id, medicine_name, supplier_name, batch_no, price_per_unit, qty_ordered, qty_received, total_amount, received_date 
             FROM pharmacy_supplier_ledger 
             WHERE received_date = $1
             ORDER BY ledger_id DESC`, [date]
        );
        res.json({ success: true, ledger: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/pharmacy/dispense-log', async (req, res) => {
    const targetDate = req.query.date || getLocalDate(); 
    try {
        const result = await pool.query(`
            SELECT p.patient_id, pt.name AS patient_name, pi.medicine_name, pi.quantity, pi.dosage,
                   TO_CHAR(p.date_recorded, 'HH24:MI') as dispense_time 
            FROM prescription_items pi
            JOIN prescriptions p ON pi.rx_id = p.rx_id
            JOIN patients pt ON p.patient_id = pt.patient_id
            WHERE p.date_recorded::date = $1 AND pi.is_dispensed = true
            ORDER BY p.date_recorded DESC`, [targetDate]
        );
        res.json({ success: true, log: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/pharmacy/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT medicine_name, current_stock FROM pharmacy_stock ORDER BY medicine_name ASC');
        res.json(result.rows); 
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/pharmacy-stock', async (req, res) => {
    try {
        const result = await pool.query('SELECT medicine_name, current_stock FROM public.pharmacy_stock ORDER BY med_id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// =========================================================================
// --- 8. PATIENT PORTAL INTERFACE MODULE ---------------------------------
// =========================================================================
app.post('/api/patient/portal-register', async (req, res) => {
    const { patient_id, phone, password } = req.body;

    try {
        // 1. VALIDATION: Check karo ki kya ID aur PHONE dono match ho rahe hain?
        const checkPatient = await pool.query(
            'SELECT patient_id FROM patients WHERE patient_id = $1 AND phone = $2', 
            [parseInt(patient_id), phone.trim()]
        );

        if (checkPatient.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Invalid ID or Phone number combination!" });
        }

        // 2. DUPLICATE CHECK: Kya is ID ka pehle se account bana hai?
        const existingAccount = await pool.query(
            'SELECT patient_id FROM patient_portal_accounts WHERE patient_id = $1', 
            [parseInt(patient_id)]
        );
        
        if (existingAccount.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Yeh account pehle se bana hua hai. Kripya login karein!" });
        }

        // 3. CREATE ACCOUNT
        await pool.query(
            'INSERT INTO patient_portal_accounts (patient_id, password_hash, is_active) VALUES ($1, $2, true)', 
            [parseInt(patient_id), password] // Note: Yahan password hash karke daalein
        );
        
        res.json({ success: true, message: "Account successfully created!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Database Error" });
    }
});
app.post('/api/patient/portal-login', async (req, res) => {

    const { patient_id, password } = req.body;

    try {

        const result = await pool.query(
            `SELECT p.patient_id, p.name, p.age, p.gender, p.phone
             FROM patient_portal_accounts ppa
             JOIN patients p ON ppa.patient_id = p.patient_id
             WHERE ppa.patient_id = $1
             AND ppa.password_hash = $2`,
            [parseInt(patient_id), password]
        );

        if (result.rows.length > 0) {
            res.json({
                success: true,
                patient: result.rows[0]
            });
        } else {
            res.status(401).json({
                success: false,
                message: "Ghalat Credentials!"
            });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: "Database Error"
        });
    }
});

app.get('/api/patient/emr/:id', async (req, res) => {
    try {
        const pId = parseInt(req.params.id);
        const visits = await pool.query(`SELECT rx_id, diagnosis, date_recorded as visit_date, 'Dr. Gupta' as doctor_name FROM prescriptions WHERE patient_id = $1`, [pId]);
        const meds = await pool.query(`SELECT m.rx_id, m.medicine_name, m.dosage, m.days, m.quantity FROM prescription_items m JOIN prescriptions p ON m.rx_id = p.rx_id WHERE p.patient_id = $1`, [pId]);
        const vitals = await pool.query(`SELECT vital_id, bp, pulse, temperature, weight, recorded_at as record_date FROM vitals WHERE patient_id = $1`, [pId]);
        
        res.json({ visits: visits.rows, medicines: meds.rows, vitals: vitals.rows });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Clinic schedule get karna (FIXED column fallbacks)
app.get('/api/admin/get-clinic-schedule', async (req, res) => {
    try {
        // Dynamic dynamic check column orders fallback safely
        const result = await pool.query('SELECT * FROM clinic_schedule ORDER BY 1 ASC');
        res.json({ success: true, schedule: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Clinic schedule update karna
app.post('/api/admin/update-clinic-schedule', async (req, res) => {
    const { day_idx, is_working, opening_time, closing_time } = req.body;
    try {
        // Fallback checks dynamically updates via both matching indexes or name
        await pool.query(
            `UPDATE clinic_schedule 
             SET is_working = $1, opening_time = $2, closing_time = $3 
             WHERE day_idx = $4`,
            [is_working, opening_time, closing_time, day_idx]
        ).catch(() => {
            return pool.query(
                `UPDATE clinic_schedule SET is_working = $1, opening_time = $2, closing_time = $3 WHERE day_index = $4`,
                [is_working, opening_time, closing_time, day_idx]
            )
        });
        res.json({ success: true, message: "Schedule updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Leave Period Add karna
app.post('/api/admin/add-leave-period', async (req, res) => {
    const { doctor_id, start_date, end_date, reason } = req.body;
    try {
        await pool.query(
            'INSERT INTO doctor_leaves (doctor_id, start_date, end_date, reason) VALUES ($1, $2, $3, $4)',
            [parseInt(doctor_id), start_date, end_date, reason]
        );
        res.json({ success: true, message: "Leave Plan Configured!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Fetch Active Notices
// Fetch Active Notices (FIXED: Explicit sequencing to avoid rendering blank frames)
app.get('/api/notices', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, title, content, TO_CHAR(posted_date, 'YYYY-MM-DD HH24:MI') as posted_date
            FROM public.clinic_circulars
            WHERE is_active = true
            ORDER BY id DESC
        `);
        res.json({ success: true, notices: result.rows });
    } catch (err) {
        console.error("Fetch Notices Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Unified view link wrapper
app.get('/api/admin/get-notices', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, title, content, TO_CHAR(posted_date, 'YYYY-MM-DD HH24:MI') as posted_date 
            FROM public.clinic_circulars 
            WHERE is_active = true 
            ORDER BY id DESC
        `);
        res.json({ success: true, notices: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
//8.Logic to add billing data to table
app.post('/api/billing/generate', async (req, res) => {
    const { patient_id, opd_fee, emergency_fee, total_amount } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Last invoice number dhundhein
        const lastBill = await client.query(`
            SELECT invoice_number FROM billing 
            ORDER BY bill_id DESC LIMIT 1
        `);

        let nextNumber = 1;
        if (lastBill.rows.length > 0) {
            const lastInv = lastBill.rows[0].invoice_number; // Format: GC-0001
            const lastNum = parseInt(lastInv.split('-')[1]); 
            nextNumber = lastNum + 1;
        }

        // 2. Format banayein (e.g., GC-0001)
        const invoice_number = `GC-${nextNumber.toString().padStart(4, '0')}`;
// Duplicate bill check
const existingBill = await client.query(`
    SELECT bill_id, invoice_number
    FROM billing
    WHERE patient_id = $1
    AND DATE(created_at) = CURRENT_DATE
    LIMIT 1
`, [patient_id]);

if (existingBill.rows.length > 0) {
    await client.query('ROLLBACK');

    return res.json({
        success: false,
        message: `Bill already generated today. Invoice No: ${existingBill.rows[0].invoice_number}`
    });

}
        // 3. Save karein
        const query = `
            INSERT INTO billing 
            (patient_id, amount, opd_fee, emergency_fee, invoice_number, payment_status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'Paid', NOW())
            RETURNING invoice_number;
        `;
        
        const result = await client.query(query, [
            patient_id, total_amount, opd_fee, emergency_fee, invoice_number
        ]);

        await client.query('COMMIT');
        res.json({ success: true, data: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});
//9.fetch old bills 
app.get('/api/billing/history/:patientId', async (req, res) => {

    try {

        const patientId =
            req.params.patientId;

        const result =
            await pool.query(
                `
                SELECT
                    bill_id,
                    invoice_number,
                    amount,
                    payment_status,
                    created_at
                FROM billing
                WHERE patient_id = $1
                ORDER BY bill_id DESC
                `,
                [patientId]
            );

        res.json({
            success: true,
            bills: result.rows
        });

    } catch(err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});
//to display doctor name in doctor-login
app.get('/api/doctor-name', async (req, res) => {
    const { doctor_id } = req.query;
    try {
        // doctors table aur users table ko join karke naam nikalein
        const result = await pool.query(
            "SELECT u.staff_name FROM users u JOIN doctors d ON u.user_id = d.user_id WHERE d.doctor_id = $1", 
            [doctor_id]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, doctor_name: result.rows[0].staff_name });
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});
app.post('/api/cancel-appointment', async (req, res) => {

    const { appointment_id } = req.body;
    console.log("Received ID for cancellation:", appointment_id);

    try {

        const result = await pool.query(`
            UPDATE appointments
            SET status='Cancelled'
            WHERE app_id=$1
            AND status IN ('Booked','Waiting')
        `, [appointment_id]);

        if (result.rowCount === 0) {
            return res.json({
                success: false,
                error: 'No matching appointment found'
            });
        }

        res.json({
            success: true,
            message: 'Appointment cancelled successfully'
        });

    } catch (err) {

        console.error("Cancellation DB Error:", err);

        res.status(500).json({
            success: false,
            error: 'Database Error'
        });

    }
});
app.post('/api/patient/forgot-password', async (req, res) => {
    const { patient_id, phone, newPassword } = req.body;

    try {
        // 1. Verify Patient ID and Phone Number from 'patients' table
        const verifyPatient = await pool.query(
            'SELECT patient_id FROM patients WHERE patient_id = $1 AND phone = $2',
            [parseInt(patient_id), phone.trim()]
        );

        if (verifyPatient.rows.length === 0) {
            return res.status(404).json({ success: false, message: "ID aur Phone match nahi kar rahe!" });
        }

        // 2. Hash hat gaya: Direct password update ho raha hai
        await pool.query(
            'UPDATE patient_portal_accounts SET password_hash = $1 WHERE patient_id = $2',
            [newPassword, parseInt(patient_id)] // Yahan 'newPassword' direct gaya
        );

        res.json({ success: true, message: "Password reset ho gaya! Ab login karein." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});
app.post('/api/book-appointment', async (req, res) => {
    

    try {

        console.log("BOOK APPOINTMENT BODY =", req.body);

        const {
            patient_id,
            doctor_id,
            visit_date
        } = req.body;
console.log("NEW BOOK APPOINTMENT ROUTE RUNNING");
        // Validation
        if (!patient_id || !doctor_id || !visit_date) {
            return res.status(400).json({
                success: false,
                message: 'Patient, Doctor and Date are required'
            });
        }

        // Duplicate booking check
       
        const existing = await pool.query(`
SELECT app_id,status
FROM appointments
WHERE patient_id=$1
AND doctor_id=$2
AND visit_date=$3
AND status NOT IN ('Cancelled')
`,
[
 patient_id,
 doctor_id,
 visit_date
]);
 console.log("Duplicate Count =", existing.rows.length);
        if (existing.rows.length > 0) {
    return res.json({
        success: false,
        message: 'Appointment already exists for this doctor and date'
    });
}

        // Queue Number
        const q = await pool.query(
            `
            SELECT COALESCE(MAX(queue_no),0)+1 AS q
            FROM appointments
            WHERE visit_date = $1
            `,
            [visit_date]
        );

        const queueNo = null;

        // Insert Appointment
        const result = await pool.query(
            `
           INSERT INTO appointments
(
 patient_id,
 doctor_id,
 visit_date,
 queue_no,
 status,
 visit_type,
 booking_source,
 is_opd,
 is_emergency
)
VALUES
(
 $1,$2,$3,$4,
 'Booked',
 'ONLINE',
 'ONLINE',
 true,
 false
)
            RETURNING app_id
            `,
            [
                patient_id,
                doctor_id,
                visit_date,
                queueNo
            ]
        );

        console.log(
            "Appointment Created:",
            result.rows[0].app_id
        );

        res.json({
            success: true,
            app_id: result.rows[0].app_id,
            queue_no: queueNo,
            message: 'Appointment booked successfully'
        });

    } catch (err) {

        console.error("BOOK APPOINTMENT ERROR:", err);

        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});
app.get('/api/online-appointments', async(req,res)=>{

 const result = await pool.query(`
    SELECT
  a.app_id,
  p.patient_id,
  p.name,
  p.phone,
  a.visit_date,
  d.doctor_id,
  u.staff_name
FROM appointments a
JOIN patients p
  ON p.patient_id=a.patient_id
JOIN doctors d
  ON d.doctor_id=a.doctor_id
JOIN users u
  ON u.user_id=d.user_id
WHERE a.status='Booked'
ORDER BY a.visit_date;
 `);

 res.json(result.rows);

});

app.get('/api/my-appointments/:patientId', async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                a.app_id,
                a.visit_date,
                a.queue_no,
                a.status,
                a.visit_type,
                u.staff_name
            FROM appointments a
            JOIN doctors d
                ON a.doctor_id = d.doctor_id
            JOIN users u
                ON d.user_id = u.user_id
            WHERE a.patient_id = $1
            ORDER BY a.visit_date DESC
        `, [req.params.patientId]);

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});
// =========================================================================
// --- 9. START SERVER CONFIGURATION ---------------------------------------
// =========================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Gupta Clinic Server successfully running on http://localhost:${PORT}`);
});
