// projectController.js
const Project = require('../models/Project');

// Controller functions for project-related operations

// Get all projects
exports.getAllProjects = async (req, res) => {
  try {
    const projects = await Project.find();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get a single project by ID
exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new project
exports.createProject = async (req, res) => {
  const project = new Project({
    name: req.body.name,
    description: req.body.description,
    // Add more fields as needed
  });

  try {
    const newProject = await project.save();
    res.status(201).json(newProject);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update an existing project
exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    project.name = req.body.name;
    project.description = req.body.description;
    // Update more fields as needed
    const updatedProject = await project.save();
    res.json(updatedProject);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a project
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    await project.remove();
    res.json({ message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
