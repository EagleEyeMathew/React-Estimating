import React, { useState } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid'; // Import UUID library

const ProjectForm = () => {
  const [formData, setFormData] = useState({
    projectId: uuidv4(), // Generate unique ID for the project
    projectName: '',
    projectDescription: '',
    projectAddress: '',
    contactName: '',
    contactEmail: '',
    contactPhone: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Send POST request to backend with form data
      const response = await axios.post('/api/project', formData);
      console.log('Project added successfully:', response.data);
      // Optionally, reset form fields after successful submission
      setFormData({
        projectId: uuidv4(), // Generate new unique ID for next project
        projectName: '',
        projectDescription: '',
        projectAddress: '',
        contactName: '',
        contactEmail: '',
        contactPhone: ''
      });
    } catch (error) {
      console.error('Error adding project:', error);
      // Handle error (e.g., display error message to user)
    }
  };

  return (
    <div>
      <h2>Add Project</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="projectName">Project Name:</label>
          <input
            type="text"
            id="projectName"
            name="projectName"
            value={formData.projectName}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label htmlFor="projectDescription">Project Description:</label>
          <textarea
            id="projectDescription"
            name="projectDescription"
            value={formData.projectDescription}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label htmlFor="projectAddress">Project Address:</label>
          <input
            type="text"
            id="projectAddress"
            name="projectAddress"
            value={formData.projectAddress}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label htmlFor="contactName">Contact Name:</label>
          <input
            type="text"
            id="contactName"
            name="contactName"
            value={formData.contactName}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label htmlFor="contactEmail">Contact Email:</label>
          <input
            type="email"
            id="contactEmail"
            name="contactEmail"
            value={formData.contactEmail}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label htmlFor="contactPhone">Contact Phone:</label>
          <input
            type="tel"
            id="contactPhone"
            name="contactPhone"
            value={formData.contactPhone}
            onChange={handleChange}
            required
          />
        </div>
        <button type="submit">Add Project</button>
      </form>
    </div>
  );
};

export default ProjectForm;
