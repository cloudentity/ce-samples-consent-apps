const express = require('express');
const axios = require('axios');
const qs = require('qs');
const https = require('https');
const res = require('express/lib/response');
const router = express.Router();
require('dotenv').config();

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

const tenant_id = process.env.TENANT_ID;
const issuer_url = process.env.ISSUER_URL;
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const auth_token = Buffer.from(`${client_id}:${client_secret}`, 'utf-8').toString('base64');
const origin = (new URL(issuer_url)).origin;

var appState = {
  access_token: null,
  id: null,
  state: null,
  redirectURI: null,
};

router.get('/', function (req, res, next) {
  res.render('health');
});

// This is the callback from ACP after the user authenticates. We validate that we have login ID 
// and login state. Then we start the flow for getting scope grants.
//
// https://docs.authorization.cloudentity.com/guides/ob_guides/custom_consent_page/?q=custom%20consent
router.get('/consent', (req, res) => {
  const login_id = req.query.login_id;
  const state = req.query.login_state;
  if (state == null || login_id == null) {
    res.render('error', { msg: 'missing state and/or login id' });
    return;
  }

  appState.id = login_id
  appState.state = state

  getScopeGrants(res);
});

// User has accepted the scope grants.
//
// https://docs.authorization.cloudentity.com/api/system/#operation/acceptLoginRequest
router.post('/accept', function (req, res, next) {
  let scopes = [];
  for (const val in req.body) {
    scopes.push(val);
  }
  const data = JSON.stringify({ granted_scopes: scopes, id: appState.id, login_state: appState.state });
  handleConsent(res, 'accept', data);
});

// User has rejected scope grants.
//
// https://docs.authorization.cloudentity.com/api/system/#operation/rejectLoginRequest
router.get('/reject', function (req, res, next) {
  const data = JSON.stringify({ id: appState.id, login_state: appState.state });
  handleConsent(res, 'reject', data);
});



const getScopeGrants = async (res) => {
  // An access token is required for making a scope grant request.
  appState.access_token = await getAccessToken(res);
  if (appState.access_token == null) {
    return;
  }

  // Once we have an access token we make an API call for a scope grant request.
  getScopeGrantRequest(res);
}

// Retrieves an access token from the system application that was created automatically when
// the custom consent page was selected in ACP. The access token is required to make a scope grant request.
//
// https://docs.authorization.cloudentity.com/api/oauth2/#operation/token
const getAccessToken = async (res) => {
  try {
    const data = qs.stringify({ grant_type: 'client_credentials', scope: 'manage_scope_grants', state: appState.access_token });

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
    console.log(error);
    res.render('error', { msg: 'error getting access token: ' + error });
  }
}

// The scope grant request is made. We then save the redirect URI and display the requested scopes
// in the UI so the user can choose which scopes to allow or reject the request.
//
// https://docs.authorization.cloudentity.com/api/system/#operation/getScopeGrantRequest
const getScopeGrantRequest = async (res) => {
  const options = {
    url: origin + '/api/system/' + tenant_id + '/scope-grants/' + appState.id + '?login_state=' + appState.state,
    method: "GET",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Bearer ' + appState.access_token,
    }
  }

  try {
    const response = await axiosInstance(options);
    appState.redirectURI = response.data.request_query_params.redirect_uri[0];
    res.render('consent', { scopes: response.data.requested_scopes });
  } catch (error) {
    console.log(error);
    res.render('error', { msg: 'error getting scope grants: ' + error });
  }
}


// The user accepts or rejects the consents. We submit the acceptance/rejection of the
// scope grants to ACP. ACP returns a redirect URI and we redirect the user to that URI or show
// an error if one is received from ACP.

// accept: https://docs.authorization.cloudentity.com/api/system/#operation/acceptLoginRequest
// reject: https://docs.authorization.cloudentity.com/api/system/#operation/rejectLoginRequest
const handleConsent = async (res, consent, data) => {
  const options = {
    url: origin + '/api/system/' + tenant_id + '/scope-grants/' + appState.id + '/' + consent,
    method: "POST",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Bearer ' + appState.access_token,
    },
    data: data
  }

  try {
    let acceptRes = await axiosInstance(options)
    res.redirect(acceptRes.data.redirect_to);
  } catch (error) {
    console.log(error);
    res.render('error', { msg: 'failed to submit consent acceptance: ' + error });
  }
}

module.exports = router;
