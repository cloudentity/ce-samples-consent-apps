const express = require('express');
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const res = require('express/lib/response');
require('dotenv').config();

const router = express.Router();

const tenant_id=process.env.TENANT_ID; 
const issuer_url=process.env.ISSUER_URL; 
const client_id = process.env.CLIENT_ID; 
const client_secret = process.env.CLIENT_SECRET; 

const auth_token = Buffer.from(`${client_id}:${client_secret}`, 'utf-8').toString('base64');
const origin = (new URL(issuer_url)).origin;

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

var appState = {
  access_token: null,
  id: null,
  state: null,
  redirectURI: null,
};

router.get('/', function (req, res, next) {
  res.render('health');
});

router.get('/consent', (req, res) => {
  const login_id = req.query.login_id;
  const state = req.query.login_state;
  if (state == '' || login_id == '') {
    res.render('error', { msg: 'missing state and/or login id' })
    return;
  }
  appState.id = login_id
  appState.state = state

  getGrants(appState).then(scopes => res.render('consent', { scopes: scopes })
  ).catch(e => {
    console.log(e)
    res.render('error', { msg: e })
  });
});

router.post('/submit', function (req, res, next) {
  let scopes = [];
  for (const scope in req.body) {
    scopes.push(scope);
  }

  const data = JSON.stringify({ granted_scopes: scopes, id: appState.id, login_state: appState.state });

  const options = {
    url: origin + '/api/system/' + tenant_id + '/scope-grants/' + appState.id + '/accept',
    method: "POST",
    path: '',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Bearer ' + appState.access_token,
    },
    data: data
  }

  axiosInstance(options).then(r => {
    res.redirect(r.data.redirect_to);
  }).catch(e => {
    console.log(e);
    res.render('error', { msg: e })});

});

const getGrants = async (appState) => {
  appState.access_token = await getToken(appState.state);
  if (appState.access_token === null) {
    res.render('error', { msg: 'error getting token' });
    return;
  }
  let scopes = await getScopeGrants(appState);
  if (scopes === null) {
    return;
  }
  return scopes;
}

const getToken = async (state) => {
  try {
    const data = qs.stringify({ grant_type: 'client_credentials', scope: 'manage_scope_grants', state: state });

    const options = {
      method: 'POST',
      url: origin + '/' + tenant_id + '/system/oauth2/token',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + auth_token
      },
      data: data
    };

    const response = await axiosInstance(options);
    return response.data.access_token;
  } catch (error) {
    console.log(e, error);
    res.render('error', { msg: 'got error on getting token - ' + error });
  }
}

const getScopeGrants = async (appState) => {
  try {
    const options = {
      url: origin + '/api/system/' + tenant_id + '/scope-grants/' + appState.id + '?login_state=' + appState.state,
      method: "GET",
      path: '',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Bearer ' + appState.access_token,
      }
    }
    const response = await axiosInstance(options);
    appState.redirectURI = response.data.request_query_params.redirect_uri[0];

    return response.data.requested_scopes;
  } catch (error) {
    console.log(e);
    res.render('error', { msg: 'failed to get scope grants - ' + error });
  }
}

module.exports = router;
