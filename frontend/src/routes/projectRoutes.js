import React from 'react';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';
import ProjectDashboard from './components/ProjectDashboard';
import ProjectDetails from './components/ProjectDetails';
import AddProjectForm from './components/AddProjectForm';

const App = () => {
  return (
    <Router>
      <Switch>
        <Route exact path="/" component={ProjectDashboard} />
        <Route path="/projects/:id" component={ProjectDetails} />
        <Route path="/add-project" component={AddProjectForm} />
        {/* Add more routes as needed */}
      </Switch>
    </Router>
  );
};

export default App;
