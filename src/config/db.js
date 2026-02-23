
const mongoose = require("mongoose");
require("dotenv").config()
const connectDb =  async() =>{
    try {
       await mongoose.connect(process.env.MONGOURL)
        console.log("connected to the db success")
    } catch (error) {
        console.log("connected db failured")
        process.exit(1)
    }
}


module.exports = {connectDb}