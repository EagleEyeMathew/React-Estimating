import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProjectDashboard from './components/ProjectDashboard';
import ProjectDetails from './components/ProjectDetails';
import HardwareList from './components/HardwareList';
import LoginForm from './components/LoginForm';
import RegistrationForm from './components/RegistrationForm';
import UserProfile from './components/UserProfile';
import ProjectForm from './components/ProjectForm';

function App() {
  return (
    <Router>
      <Routes>
        <Route exact path="/" element={<ProjectDashboard />} />
        <Route path="/project/:id" element={<ProjectDetails />} />
        <Route path="/project" element={<ProjectDashboard />} /> {/* New route for managing projects */}
        <Route path="/hardware" element={<HardwareList />} />
        <Route path="/login" element={<LoginForm />} />
        <Route path="/register" element={<RegistrationForm />} />
        <Route path="/profile" element={<UserProfile />} />
        <Route path="/add-project" element={<ProjectForm />} />
      </Routes>
    </Router>
  );
}

export default App;
