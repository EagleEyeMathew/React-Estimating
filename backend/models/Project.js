const mongoose = require('mongoose');

// Connect to MongoDB database
mongoose.connect('mongodb://localhost:27017/joinery-estimation', {
  // Other options...
});

const db = mongoose.connection;

// Handle database connection events
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB database');
});

// Define Mongoose schema for Project
const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  address: String,
  contact: {
    name: String,
    email: String,
    phone: String
  },
  uniqueNumber: {
    type: String,
    unique: true,
    required: true
  }
});

// Define the Project model using the schema
const Project = mongoose.model('Project', projectSchema);

// Export the Project model
module.exports = {
  Project
};
