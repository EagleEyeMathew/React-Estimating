// src/controllers/projectController.js
const Project = require('../models/project');

exports.getAllProjects = async (req, res) => {
  try {
    const projects = await Project.findAll();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getProjectById = async (req, res) => {
  const { id } = req.params;
  try {
    const project = await Project.findByPk(id);
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createProject = async (req, res) => {
  const { name, description } = req.body;
  try {
    const project = await Project.create({ name, description });
    res.status(201).json(project);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateProject = async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    let project = await Project.findByPk(id);
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    project.name = name;
    project.description = description;
    await project.save();
    res.json(project);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteProject = async (req, res) => {
  const { id } = req.params;
  try {
    const project = await Project.findByPk(id);
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    await project.destroy();
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
