import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom'; // Import Link from react-router-dom
import { themeColor } from '../themes/theme'; // Adjust the path as needed

const ProjectDashboard = () => {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    // Fetch projects from backend API
    axios.get('/api/project')
      .then(response => {
        setProjects(response.data);
      })
      .catch(error => {
        console.error('Error fetching projects:', error);
      });

    // Set theme color dynamically
    document.documentElement.style.setProperty('--theme-color', themeColor);
  }, []); // Empty dependency array ensures the effect runs only once when component mounts

  return (
    <div style={{ backgroundColor: 'lightblue', color: 'black' }}>
      <h2>Project Dashboard</h2>
      <ul>
        {projects.map(project => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
      <div>
        {/* Button to add a new project */}
        <Link to="/add-projec">
          <button>Add New Project</button>
        </Link>
        {/* Button to view hardware list */}
        <Link to="/hardware">
          <button>View Hardware List</button>
        </Link>
      </div>
    </div>
  );
};

export default ProjectDashboard;
