# Firebase Setup Guide for Frontend-Only Architecture

## Overview

Your app has been successfully converted to a frontend-only architecture using Firebase client SDK. This eliminates the need for a backend server and allows you to deploy entirely on Firebase's free tier.

## 🔧 Step 1: Get Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/project/night-duty-app/settings/general)
2. Scroll down to "Your apps" section
3. If you don't see a web app, click "Add app" and select the web icon (`</>`)
4. Register your app with a nickname (e.g., "Night Duty Web App")
5. Copy the `firebaseConfig` object shown

It will look like this:
```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "night-duty-app.firebaseapp.com",
  projectId: "night-duty-app",
  storageBucket: "night-duty-app.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123..."
}
```

6. Replace the values in `frontend/src/config/firebase.ts` with your actual configuration

## 🔒 Step 2: Set Up Authentication

### Enable Email/Password Authentication

1. Go to [Firebase Console > Authentication](https://console.firebase.google.com/project/night-duty-app/authentication/providers)
2. Click on "Get started" (if first time) or "Sign-in method"
3. Click on "Email/Password"
4. Enable "Email/Password" (first toggle)
5. Click "Save"

### Create Your First User

1. Go to [Firebase Console > Authentication > Users](https://console.firebase.google.com/project/night-duty-app/authentication/users)
2. Click "Add user"
3. Enter your email and password
4. Click "Add user"

## 🛡️ Step 3: Configure Firestore Security Rules

1. Go to [Firebase Console > Firestore Database > Rules](https://console.firebase.google.com/project/night-duty-app/firestore/rules)
2. Replace the current rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Require authentication for all operations
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Click "Publish"

## 📦 Step 4: Deploy the Application

Run these commands from the project root:

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

Your app will be live at: **https://night-duty-app.web.app**

## ✅ Step 5: Test the Application

1. Open https://night-duty-app.web.app in your browser
2. You should be redirected to the login page
3. Sign in with the email and password you created in Step 2
4. You should now have access to the full application!

## 🎯 What Changed?

### Removed:
- ✅ Backend Express server (`/backend` directory)
- ✅ Firebase Cloud Functions (`/functions` directory)
- ✅ Axios HTTP calls
- ✅ Need for Blaze plan

### Added:
- ✅ Firebase client SDK integration
- ✅ Direct Firestore operations from frontend
- ✅ Email/Password authentication
- ✅ Protected routes
- ✅ Schedule generation runs in browser

### Benefits:
- 💰 **Free hosting** - stays on Firebase free tier
- ⚡ **Faster** - no API round trips
- 🔄 **Real-time** - can easily add real-time updates
- 🔒 **Secure** - authentication required for all operations
- 🚀 **Simpler** - no backend to maintain

## 🔐 Security Notes

- All Firestore operations require authentication
- Users must sign in before accessing the app
- Firestore security rules enforce authentication at the database level
- You can add more users from Firebase Console > Authentication > Users

## 🐛 Troubleshooting

### "Firebase: Error (auth/invalid-api-key)"
- Check that you've replaced the Firebase config in `frontend/src/config/firebase.ts` with your actual values

### "Missing or insufficient permissions"
- Make sure you've published the Firestore security rules from Step 3
- Verify you're signed in (check browser console for auth state)

### "Cannot read properties of undefined"
- Clear browser cache and localStorage
- Sign out and sign in again

## 📝 Next Steps

1. Replace Firebase config with your actual values
2. Set up authentication and create your first user
3. Configure Firestore security rules
4. Deploy and test!

All your existing data in Firestore (saints, availability, schedules) will continue to work without any changes!

