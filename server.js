/**
 * JavaGoat Exam Portal - Server Entry Point
 * Author: Expert Full-Stack Developer
 * Description: Main server file handling Express, MongoDB, Sessions, and RESTful APIs.
 */

// ==========================================
// SECTION 1: IMPORTS & INITIAL SETUP
// ==========================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// SECTION 2: DATABASE CONNECTION & CONFIG
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://root:root@cluster0.bctlwhf.mongodb.net/?appName=Cluster0';
const SESSION_SECRET = process.env.SESSION_SECRET;

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('[DB] MongoDB Connected successfully.');
    seedDatabase(); // Seed initial admin and student
}).catch(err => {
    console.error('[DB] MongoDB Connection Error:', err.message);
});

// ==========================================
// SECTION 3: EXPRESS MIDDLEWARE CONFIGURATION
// ==========================================
// Configure Express to accept large payloads for Base64 file uploads (limit: 50mb)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session Configuration for Render (Secure, Mongo Store)
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 1 Day
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' // true on Render
    }
}));

// View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// SECTION 4: DATABASE MODELS (MONGOOSE)
// ==========================================

// 4.1 Department Model
const DepartmentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true }
}, { timestamps: true });
const Department = mongoose.model('Department', DepartmentSchema);

// 4.2 User Model
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'student'], default: 'student' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    studentId: { type: String, unique: true, sparse: true },
    profilePhoto: { type: String, default: '' }, // Base64 string
    wallet: { type: Number, default: 0 } // For UI Stat Box Requirement
}, { timestamps: true });

// Pre-save hook to auto-generate Student IDs (ST0001, ST0002...)
UserSchema.pre('save', async function(next) {
    if (this.isNew && this.role === 'student') {
        try {
            const count = await mongoose.model('User').countDocuments({ role: 'student' });
            this.studentId = 'ST' + String(count + 1).padStart(4, '0');
            next();
        } catch (err) {
            return next(err);
        }
    } else {
        next();
    }
});
const User = mongoose.model('User', UserSchema);

// 4.3 Exam Model
const ExamSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    duration: { type: Number, required: true }, // in minutes
    passingPercentage: { type: Number, default: 50 },
    questions: [{
        type: { type: String, enum: ['mcq', 'file'], required: true },
        questionText: { type: String },
        questionFile: { type: String }, // Base64
        options: { type: [String], default: [] },
        correctAnswer: { type: String },
        marks: { type: Number, default: 1 }
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });
const Exam = mongoose.model('Exam', ExamSchema);

// 4.4 Submission Model
const SubmissionSchema = new mongoose.Schema({
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [{
        questionIndex: { type: Number },
        selectedAnswer: { type: String },
        answerFile: { type: String } // Base64
    }],
    score: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    needsManualGrading: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    timeTaken: { type: Number }, // in seconds
    isSubmitted: { type: Boolean, default: false }
}, { timestamps: true });
const Submission = mongoose.model('Submission', SubmissionSchema);

// 4.5 Video Model
const VideoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    youtubeUrl: { type: String, required: true }
}, { timestamps: true });
const Video = mongoose.model('Video', VideoSchema);

// 4.6 Message Model
const MessageSchema = new mongoose.Schema({
    subject: { type: String, required: true },
    body: { type: String, required: true },
    toStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fromAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    read: { type: Boolean, default: false }
}, { timestamps: true });
const Message = mongoose.model('Message', MessageSchema);

// ==========================================
// SECTION 5: AUTHENTICATION MIDDLEWARE
// ==========================================
const isAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ msg: 'Unauthorized: Please login' });
    next();
};

const isAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ msg: 'Forbidden: Admin access only' });
    }
    next();
};

// ==========================================
// SECTION 6: GENERAL & AUTH ROUTES
// ==========================================

// 6.1 Root Render Route
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user || null });
});

// 6.2 Register API
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, role, department } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ msg: 'Name, email, and password are required' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ msg: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new User({
            name, email, password: hashedPassword,
            role: role || 'student', department
        });
        await newUser.save();

        req.session.user = {
            id: newUser._id, name: newUser.name, email: newUser.email,
            role: newUser.role, studentId: newUser.studentId, department: newUser.department
        };
        res.status(201).json({ msg: 'Registration successful', user: req.session.user });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// 6.3 Login API
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ msg: 'Email and password required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

        req.session.user = {
            id: user._id, name: user.name, email: user.email,
            role: user.role, studentId: user.studentId,
            department: user.department, profilePhoto: user.profilePhoto
        };
        res.json({ msg: 'Login successful', user: req.session.user });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// 6.4 Logout API
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ msg: 'Logout failed' });
        res.clearCookie('connect.sid');
        res.json({ msg: 'Logged out successfully' });
    });
});

// 6.5 Update Profile (Base64 Photo)
app.post('/api/user/profile', isAuth, async (req, res) => {
    try {
        const { profilePhoto, name } = req.body;
        const user = await User.findById(req.session.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        
        if (profilePhoto) user.profilePhoto = profilePhoto;
        if (name) user.name = name;
        await user.save();

        req.session.user.name = user.name;
        req.session.user.profilePhoto = user.profilePhoto;
        res.json({ msg: 'Profile updated', user: req.session.user });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// 6.6 Get Departments (Public)
app.get('/api/departments', async (req, res) => {
    try {
        const departments = await Department.find().sort({ name: 1 });
        res.json(departments);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// ==========================================
// SECTION 7: ADMIN ROUTES
// ==========================================

// 7.1 Admin Dashboard Aggregation
app.get('/api/admin/dashboard', isAdmin, async (req, res) => {
    try {
        const submissions = await Submission.find({ isSubmitted: true }).populate('exam');
        const passed = submissions.filter(s => s.passed).length;
        const failed = submissions.length - passed;
        
        const exams = await Exam.find();
        const avgScores = exams.map(exam => {
            const examSubs = submissions.filter(s => s.exam && s.exam._id.toString() === exam._id.toString());
            const avg = examSubs.length > 0 ? examSubs.reduce((sum, s) => sum + s.percentage, 0) / examSubs.length : 0;
            return { title: exam.title, avg: Math.round(avg) };
        });

        res.json({
            passFail: { passed, failed },
            avgScores,
            totalExams: exams.length,
            totalStudents: await User.countDocuments({ role: 'student' })
        });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

// 7.2 CRUD Departments
app.get('/api/admin/departments', isAdmin, async (req, res) => {
    res.json(await Department.find());
});
app.post('/api/admin/departments', isAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ msg: 'Name required' });
        const dept = new Department({ name });
        await dept.save();
        res.status(201).json(dept);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});
app.put('/api/admin/departments/:id', isAdmin, async (req, res) => {
    try {
        const dept = await Department.findByIdAndUpdate(req.params.id, { name: req.body.name }, { new: true });
        res.json(dept);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});
app.delete('/api/admin/departments/:id', isAdmin, async (req, res) => {
    try {
        await Department.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Department deleted' });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.3 CRUD Exams
app.get('/api/admin/exams', isAdmin, async (req, res) => {
    res.json(await Exam.find().populate('department').sort({ createdAt: -1 }));
});
app.post('/api/admin/exams', isAdmin, async (req, res) => {
    try {
        const { title, description, department, duration, passingPercentage } = req.body;
        const exam = new Exam({
            title, description, department, duration, passingPercentage,
            createdBy: req.session.user.id, questions: []
        });
        await exam.save();
        res.status(201).json(exam);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});
app.delete('/api/admin/exams/:id', isAdmin, async (req, res) => {
    try {
        await Exam.findByIdAndDelete(req.params.id);
        res.json({ msg: 'Exam deleted' });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.4 Add Questions to Exam
app.post('/api/admin/exams/:id/questions', isAdmin, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);
        if (!exam) return res.status(404).json({ msg: 'Exam not found' });
        
        const { type, questionText, questionFile, options, correctAnswer, marks } = req.body;
        exam.questions.push({
            type, questionText, questionFile,
            options: options || [], correctAnswer, marks: marks || 1
        });
        await exam.save();
        res.status(201).json(exam);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.5 Get Submissions for Exam
app.get('/api/admin/exams/:id/submissions', isAdmin, async (req, res) => {
    try {
        const subs = await Submission.find({ exam: req.params.id }).populate('user').populate('exam');
        res.json(subs);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.6 Grade Submission (Manual Override)
app.put('/api/admin/submissions/:id/grade', isAdmin, async (req, res) => {
    try {
        const { score, passed } = req.body;
        const sub = await Submission.findById(req.params.id).populate('exam');
        if (!sub) return res.status(404).json({ msg: 'Submission not found' });
        
        sub.score = score;
        sub.passed = passed;
        sub.needsManualGrading = false;
        sub.percentage = sub.totalMarks > 0 ? (score / sub.totalMarks) * 100 : 0;
        await sub.save();
        res.json(sub);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.7 CRUD Videos
app.get('/api/admin/videos', isAdmin, async (req, res) => { res.json(await Video.find()); });
app.post('/api/admin/videos', isAdmin, async (req, res) => {
    try {
        const vid = new Video(req.body);
        await vid.save();
        res.status(201).json(vid);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});
app.delete('/api/admin/videos/:id', isAdmin, async (req, res) => {
    try { await Video.findByIdAndDelete(req.params.id); res.json({ msg: 'Deleted' }); } 
    catch (err) { res.status(500).json({ msg: err.message }); }
});

// 7.8 Send Message
app.post('/api/admin/messages', isAdmin, async (req, res) => {
    try {
        const { subject, body, toStudent } = req.body;
        const msg = new Message({
            subject, body, toStudent,
            fromAdmin: req.session.user.id
        });
        await msg.save();
        res.status(201).json(msg);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// ==========================================
// SECTION 8: STUDENT ROUTES
// ==========================================

// 8.1 Student Dashboard
app.get('/api/student/dashboard', isAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);
        const activeExams = await Exam.find({ isActive: true, department: user.department }).populate('department');
        const previousSubmissions = await Submission.find({ user: user._id, isSubmitted: true }).populate('exam');
        const inboxCount = await Message.countDocuments({ toStudent: user._id, read: false });
        
        res.json({ user, activeExams, previousSubmissions, inboxCount });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 8.2 Start Exam
app.post('/api/student/exams/:id/start', isAuth, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);
        if (!exam) return res.status(404).json({ msg: 'Exam not found' });
        
        // Check if already started but not submitted
        let submission = await Submission.findOne({ exam: exam._id, user: req.session.user.id, isSubmitted: false });
        if (submission) return res.json({ msg: 'Resume exam', submission });
        
        const totalMarks = exam.questions.reduce((sum, q) => sum + q.marks, 0);
        const needsManual = exam.questions.some(q => q.type === 'file');
        
        submission = new Submission({
            exam: exam._id, user: req.session.user.id, totalMarks,
            needsManualGrading: needsManual,
            answers: exam.questions.map((q, i) => ({ questionIndex: i, selectedAnswer: '', answerFile: '' }))
        });
        await submission.save();
        res.status(201).json({ msg: 'Exam started', submission });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 8.3 Submit Exam
app.post('/api/student/submissions/:id/submit', isAuth, async (req, res) => {
    try {
        const { answers, timeTaken } = req.body;
        const sub = await Submission.findById(req.params.id).populate('exam');
        if (!sub) return res.status(404).json({ msg: 'Submission not found' });
        
        sub.answers = answers;
        sub.timeTaken = timeTaken;
        sub.submittedAt = new Date();
        sub.isSubmitted = true;
        
        let score = 0;
        sub.answers.forEach(ans => {
            const q = sub.exam.questions[ans.questionIndex];
            if (q && q.type === 'mcq') {
                if (ans.selectedAnswer === q.correctAnswer) score += q.marks;
            }
        });
        
        sub.score = score;
        sub.percentage = sub.totalMarks > 0 ? (score / sub.totalMarks) * 100 : 0;
        sub.passed = sub.percentage >= sub.exam.passingPercentage;
        
        await sub.save();
        res.json({ msg: 'Exam submitted', submission: sub });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 8.4 Get Messages
app.get('/api/messages', isAuth, async (req, res) => {
    try {
        const msgs = await Message.find({ toStudent: req.session.user.id }).sort({ createdAt: -1 });
        // Mark as read
        await Message.updateMany({ toStudent: req.session.user.id, read: false }, { read: true });
        res.json(msgs);
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// 8.5 Get Videos
app.get('/api/videos', isAuth, async (req, res) => {
    try { res.json(await Video.find().sort({ createdAt: -1 })); } 
    catch (err) { res.status(500).json({ msg: err.message }); }
});

// ==========================================
// SECTION 9: DATABASE SEEDING
// ==========================================
async function seedDatabase() {
    try {
        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount === 0) {
            const hashed = await bcrypt.hash('admin123', 12);
            await User.create({
                name: 'Admin Goat', email: 'admin@javagoat.com',
                password: hashed, role: 'admin'
            });
            console.log('[SEED] Admin user created (admin@javagoat.com / admin123)');
        }

        const studentCount = await User.countDocuments({ role: 'student' });
        if (studentCount === 0) {
            let dept = await Department.findOne({ name: 'Computer Science' });
            if (!dept) dept = await Department.create({ name: 'Computer Science' });
            
            const hashed = await bcrypt.hash('student123', 12);
            await User.create({
                name: 'Student Goat', email: 'student@javagoat.com',
                password: hashed, role: 'student', department: dept._id
            });
            console.log('[SEED] Student user created (student@javagoat.com / student123)');
        }
    } catch (err) {
        console.error('[SEED] Error:', err.message);
    }
}

// ==========================================
// SECTION 10: SERVER LISTEN
// ==========================================
app.listen(PORT, () => {
    console.log(`[SERVER] JavaGoat Exam Portal running on port ${PORT}`);
});
