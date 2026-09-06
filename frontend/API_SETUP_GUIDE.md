# API Setup Guide

## Overview

The Breakdown Assist App communicates with a backend API. To make the API calls work, you need to:
1. **Start the backend server** (already done ✅)
2. **Configure the correct API URL** in `.env` based on your development environment

## Backend Server Status

✅ **Backend is currently running on:** `http://localhost:3000`

## API URL Configuration

The API URL is configured in `.env` using `EXPO_PUBLIC_API_URL`. 

### Choose the correct URL based on your environment:

#### **Android Emulator** (Recommended for development)
```
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```
⚠️ **Why 10.0.2.2?** Android emulator uses this special IP to reach the host machine's localhost.

#### **iOS Simulator**
```
EXPO_PUBLIC_API_URL=http://localhost:3000
```

#### **Physical Device** (Android or iOS)
```
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:3000
```
Replace `YOUR_LOCAL_IP` with your machine's local network IP (e.g., `192.168.1.100`)

To find your machine's IP:
- **Windows:** Run `ipconfig` in terminal and look for "IPv4 Address" under your network adapter
- **Mac/Linux:** Run `ifconfig` or `hostname -I`

## Current Configuration

Currently `.env` is set for **Android Emulator**:
```
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
```

## Troubleshooting

### "Network request failed" Error

This error occurs when the app cannot reach the backend. Check:

1. **Backend is running?**
   ```bash
   # Terminal output should show:
   # 🚀 Backend server running on http://localhost:3000
   ```

2. **Correct API URL in `.env`?**
   - Print your current `.env` to verify
   - Make sure URL matches your environment (emulator/simulator/device)

3. **Check the Logs**
   - Look for `[API Client]` logs in the React Native console
   - They will show the URL being used and request details

4. **Network Connectivity**
   - Ensure your device/emulator can reach the host machine
   - Firewall might be blocking: Add Node.js/npm to firewall exceptions

## API Endpoints

### Health Check
```
GET http://localhost:3000/health
Response: { status: "OK", message: "..." }
```

### Authentication Endpoints
```
POST /api/auth/signup      - Register new user
POST /api/auth/login       - Login user
GET  /api/auth/user/:id    - Get user profile
PUT  /api/auth/user/:id    - Update user profile
POST /api/auth/check-email - Check email availability
```

## Quick Start Checklist

Before testing the signup page:

- [ ] Backend server is running (`npm run dev` in backend directory)
- [ ] Correct `EXPO_PUBLIC_API_URL` is set in `.env`
- [ ] Frontend app is running (`npm start` or `expo start`)
- [ ] Android emulator/iOS simulator is running
- [ ] Check browser/emulator console for `[API Client]` logs

## Next Steps

1. Open the app and navigate to the Signup page
2. Watch the console logs to verify API calls
3. If errors occur, logs will show the exact URL and error details
4. Refer to [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md) for detailed API reference

---

**Need help?** Check the console logs - they're verbose and show exactly what's happening!
