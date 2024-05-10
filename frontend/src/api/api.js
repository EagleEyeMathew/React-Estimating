// src/api/api.js
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3001'; // Adjust this URL based on your backend server configuration

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
});

const api = {
  // Function to fetch projects
  getProjects: async () => {
    try {
      const response = await axiosInstance.get('/api/project');
      return response.data;
    } catch (error) {
      console.error('Error fetching projects:', error);
      throw new Error(error.response?.data?.message || 'Failed to fetch projects');
    }
  },
  // Function to create projects
  createProject: async (projectdata) => {
    try {
      const response = await axiosInstance.get('/api/project', projectdata);
      return response.data;
    } catch (error) {
      console.error('Error creating projects:', error);
      throw new Error(error.response?.data?.message || 'Failed to create projects');
    }
  },


  // Other API functions (e.g., createProject, updateProject, deleteProject) can be defined similarly
};

export default api;
