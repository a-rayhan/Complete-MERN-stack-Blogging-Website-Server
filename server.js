import express, { json } from 'express';
import mongoose from 'mongoose';
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import admin from 'firebase-admin';
import { getAuth } from "firebase-admin/auth";
import serviceAccountKey from "./event-flow-d8d7f-firebase-adminsdk-6t1o6-f8b5673cbf.json" assert { type: "json" };


// import Schema below
import User from './Schema/User.js';
import Blog from './Schema/Blog.js';
import Notification from './Schema/Notification.js';
import Comment from './Schema/Comment.js';

const server = express();
let PORT = 3000;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKey)
})

// regex
let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/; // regex for password

// middleware
server.use(express.json());
server.use(cors());

mongoose.connect(process.env.DB_LOCATION, {
    autoIndex: true
});

const verifyJWT = (req, res, next) => {
    const authHeader = req.header('authorization');
    const token = authHeader && authHeader.split(" ")[1];

    if (token == null) {
        return res.status(401).json({ "error": "No access token" })
    }

    jwt.verify(token, process.env.SECRET_ACCESS_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ "error": "Access token is invlaid" })
        }

        req.user = user.id;
        next();
    })
}

const formatDataToSend = (user) => {

    const access_token = jwt.sign({ id: user._id }, process.env.SECRET_ACCESS_KEY)

    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username,
        fullname: user.personal_info.fullname
    }
}

const generateUsername = async (email) => {
    let username = email.split("@")[0];

    let usernameExists = await User.exists({ "personal_info.username": username }).then(result => result)

    usernameExists ? username += nanoid().substring(0, 3) : "";

    return username;
}

server.post("/signup", (req, res) => {
    let { fullname, email, password } = req.body;

    if (fullname.length < 3) {
        return res.status(403).json({ "error": "Fullname must be at least 3 letters long" })
    }

    if (!email.length) {
        return res.status(403).json({ "error": "Enter email" })
    }

    if (!emailRegex.test(email)) {
        return res.status(403).json({ "error": "Email not valid" })
    }

    if (!passwordRegex.test(password)) {
        return res.status(403).json({ "error": "Password should be 6 to 20 characters long with a numeric, 1 lowercase and 1 uppercase letters" })
    }

    bcrypt.hash(password, 10, async (err, hashed_password) => {
        let username = await generateUsername(email);

        let user = new User({
            personal_info: { fullname, email, username, password: hashed_password }
        })

        user.save().then((u) => {
            return res.status(200).json(formatDataToSend(u))
        })
            .catch(err => {

                if (err.code == 11000) {
                    return res.status(500).json({ "error": "Email already exist" })
                }

                return res.status(500).json({ "error": err.message })
            })
    })

    // return res.status(200).json({ "status": "Okay" })
})

server.post("/signin", (req, res) => {
    let { email, password } = req.body;

    User.findOne({ "personal_info.email": email })
        .then((user) => {

            if (!user) {
                return res.status(403).json({ "error": "Email not found" })
            }

            bcrypt.compare(password, user.personal_info.password, (err, result) => {
                if (err) {
                    return res.status(403).json({ "error": "Error occured while login please try again!" })
                }

                if (!result) {
                    return res.status(403).json({ "error": "Incorrect password" })
                } else {
                    return res.status(200).json(formatDataToSend(user))
                }
            })
        })
        .catch(err => {
            console.log(err.message);
            return res.status(403).json({ "error": err.message })
        })
})

server.post("/google-auth", async (req, res) => {
    let { access_token } = req.body;

    getAuth()
        .verifyIdToken(access_token)
        .then(async (decodedUser) => {
            let { email, name, picture } = decodedUser;

            picture = picture.replace("s96-c", "s384-c")

            let user = await User.findOne({ "perspersonal_info.email": email }).select("personal_info.profile_img personal_info.username personal_info.fullname google_auth").then((u) => {
                return u || null
            })
                .catch(err => {
                    return res.status(500).json({ "error": err.message })
                })

            if (user) {
                if (!user.google_auth) {
                    return res.status(403).json({ "error": "This email was signed up without google. Please log in with password to access the account" })
                } else {
                    let username = generateUsername(email)

                    user = new User({
                        personal_info: { fullname: name, email },
                        google_auth: true
                    })

                    await user.save().then((u) => {
                        user = u;
                    })
                        .catch(err => {
                            return res.status(500).json({ "error": err.message })
                        })
                }
            }

            return res.status(200).json(formatDataToSend(user))

        })
        .catch(err => {
            return res.status(500).json({ "error": "Failed to authenticate you with google. Try with some other google account" })
        })
})


server.post('/latest-blogs', (req, res) => {


    let { page } = req.body;

    let maxLimit = 5;

    Blog.find({ draft: false })
        .populate("author", "personal_info.profile_img personal_info.fullname personal_info.username -_id")
        .sort({ "publishedAt": -1 })
        .select("blog_id title des banner activity tags publishedAt -_id")
        .skip((page - 1) * maxLimit)
        .limit(maxLimit)
        .then(blogs => {
            return res.status(200).json({ blogs })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/all-latest-blogs-count", (req, res) => {
    Blog.countDocuments({ draft: false })
        .then(count => {
            return res.status(200).json({ totalDocs: count })
        })
        .catch(err => {
            console.log(err);
            return res.status(500).json({ error: err.message })
        })
})

server.get('/trending-blogs', (req, res) => {

    Blog.find({ draft: false })
        .populate("author", "personal_info.profile_img personal_info.fullname personal_info.username -_id")
        .sort({ "activity.total_read": -1, "activity.total_likes": -1, "publishedAt": -1 })
        .select("blog_id title publishedAt -_id")
        .limit(5)
        .then(blogs => {
            return res.status(200).json({ blogs })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/search-blogs", (req, res) => {


    let { tag, query, author, page, limit, eliminate_blog } = req.body;

    let findQuery;

    if (tag) {
        findQuery = { tags: tag, draft: false, blog_id: { $ne: eliminate_blog } };
    } else if (query) {
        findQuery = { draft: false, title: new RegExp(query, 'i') };
    } else if (author) {
        findQuery = { author, draft: false };
    }

    let maxLimit = limit ? limit : 2;

    Blog.find(findQuery)
        .populate("author", "personal_info.profile_img personal_info.fullname personal_info.username -_id")
        .sort({ "publishedAt": -1 })
        .select("blog_id title des banner activity tags publishedAt -_id")
        .skip((page - 1) * maxLimit)
        .limit(maxLimit)
        .then(blogs => {
            return res.status(200).json({ blogs })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/get-profile", (req, res) => {
    let { username } = req.body;

    User.findOne({ "personal_info.username": username })
        .select("-personal_info.password -google_auth -updateAt -blogs")
        .then(user => {
            return res.status(200).json(user)
        })
        .catch(err => {
            console.log(err);
            return res.status(500).json({ error: err.message })
        })
})

server.post("/search-users", (req, res) => {
    let { query } = req.body;

    User.find({ "personal_info.username": new RegExp(query, 'i') })
        .limit(50)
        .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
        .then(users => {
            return res.status(200).json({ users })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/search-blogs-count", (req, res) => {
    let { tag, author, query } = req.body;

    let findQuery;

    if (tag) {
        findQuery = { tags: tag, draft: false };
    } else if (query) {
        findQuery = { draft: false, title: new RegExp(query, 'i') };
    } else if (author) {
        findQuery = { author, draft: false };
    }

    Blog.countDocuments(findQuery)
        .then(count => {
            return res.status(200).json({ totalDocs: count })
        })
        .catch(err => {
            console.log(err);
            return res.status(500).json({ error: err.message })
        })
})


server.post('/create-blog', verifyJWT, (req, res) => {
    let authorId = req.user;
    let { title, des, banner, tags, content, draft, id } = req.body;

    if (!title.length) {
        return res.status(403).json({ "error": "You must provide a tittle to publish blog" })
    }

    if (!draft) {
        if (!des.length || des.length > 200) {
            return res.status(403).json({ "error": "You must provide description under 200 characters" })
        }
    }

    tags = tags.map(tag => tag.toLowerCase());

    let blog_id = id || title.replace(/[^a-zA-Z0-9]/g).replace(/\s+/g, "-").trim() + nanoid();


    if (id) {

        Blog.findOneAndUpdate({ blog_id }, { title, des, banner, content, tags, draft: draft ? draft : false })
            .then(() => {
                res.status(200).json({ id: blog_id })
            })
            .catch(err => {
                res.status(500).json({ "error": "Failed to update total posts number" })
            })

    } else {
        let blog = new Blog({
            title, des, banner, content, tags, author: authorId, blog_id, draft: Boolean(draft)
        })

        blog.save().then(blog => {
            let increamentVal = draft ? 0 : 1;

            User.findOneAndUpdate({ _id: authorId }, { $inc: { "account_info.total_posts": increamentVal }, $push: { "blogs": blog._id } })
                .then(user => {
                    res.status(200).json({ id: blog.blog_id })
                }).catch(err => {
                    res.status(500).json({ "error": "Failed to update total posts number" })
                })
        }).catch(err => {
            res.status(500).json({ error: err.message })
        })
    }

})

server.post("/get-blog", (req, res) => {

    let { blog_id, draft, mode } = req.body;

    let increamentVal = mode !== "edit" ? 1 : 0;

    Blog.findOneAndUpdate({ blog_id }, { $inc: { "activity.total_reads": increamentVal } })
        .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
        .select("title des content banner activity publishedAt blog_id tags")
        .then(blog => {

            User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username }, {
                $inc: { "account_info.total_reads": increamentVal }
            })
                .catch(err => {
                    return res.status(500).json({ error: err.message })
                })

            if (blog.draft && !draft) {
                return res.status(500).json({ error: "You can not access draft blogs" })
            }

            return res.status(200).json({ blog })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/like-blog", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id, isLikedByUser } = req.body;

    let increamentVal = !isLikedByUser ? 1 : -1;

    Blog.findOneAndUpdate({ _id }, { $inc: { "activity.total_likes": increamentVal } })
        .then((blog) => {
            console.log();

            if (!isLikedByUser) {
                let like = new Notification({
                    type: "like",
                    blog: _id,
                    notification_for: blog.author,
                    user: user_id,
                })

                like.save().then(notification => {
                    return res.status(200).json({ liked_by_user: true })
                })
            } else {
                Notification.findOneAndDelete({ user: user_id, type: "like", blog: _id })
                    .then(data => {
                        return res.status(200).json({ liked_by_user: false })
                    })
                    .catch(err => {
                        return res.status(500).json({ error: err.message })
                    })
            }

        })
})

server.post("/isliked-by-user", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id } = req.body;

    Notification.exists({ user: user_id, type: "like", blog: _id })
        .then(result => {
            return res.status(200).json({ result })
        })
        .catch(err => {
            return res.status(500).json({ error: err.message })
        })
})

server.post("/add-comment", verifyJWT, (req, res) => {
    let user_id = req.user;

    let { _id, comment, blog_author } = req.body;

    if (!comment.length) {
        return res.status(403).json({ error: "Write something to leave a comment" })
    }

    let commentObj = new Comment({
        blog_id: _id, blog_author, comment, commented_by: user_id,
    })

    commentObj.save().then((commentFile) => {

        console.log(commentFile);
        let { comment, commentedAt, children } = commentFile;

        Blog.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc: { "activity.total_comments": 1, "activity.total_parent_comments": 1 } })
            .then(blog => { console.log("New comment created"); })

        let notificationObj = {
            type: "comment",
            blog: _id,
            notification_for: blog_author,
            user: user_id,
            comment: commentFile._id
        }

        new Notification(notificationObj).save().then(notification => console.log("New notification created"))

        return res.status(200).json({
            comment, commentedAt, _id: commentFile._id, user_id, children
        })
    })
})

server.post("/get-blog-comments", (req, res) => {
    let { blog_id, skip } = req.body;

    let maxLimit = 5;

    Comment.find({ blog_id, isReply: false })
        .populate("commented_by", "personal_info.username personal_info.fullname personal_info.profile_img")
        .skip(skip)
        .limit(maxLimit)
        .sort({
            "commentedAt": -1
        })

        .then(comment => {
            return res.status(200).json(comment)
        })
        .catch(err => {
            console.log(err.message);
            return res.status(500).json({ error: err.message })
        })
})

server.listen(PORT, () => {
    console.log("Listening on port" + PORT);
})