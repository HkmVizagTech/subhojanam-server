
const mongoose = require("mongoose");
const dns = require("dns");
require("dotenv").config()

// Some local networks' default DNS resolver can't handle the SRV lookups
// that mongodb+srv:// URIs need. Point at a public resolver in dev only.
if (process.env.NODE_ENV === "development") {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const connectDb =  async() =>{
    try {
       await mongoose.connect(process.env.MONGOURL)
        console.log("connected to the db success")
    } catch (error) {
        console.log("connected db failured:", error.message)
        process.exit(1)
    }
}


module.exports = {connectDb}