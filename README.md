# Night Duty App

A modern, intelligent scheduling system that automatically assigns night duty staff with constraints, preferences, and emergency backup management.

## Features

- 🎲 **Smart Scheduling**: Automatically generate monthly schedules with constraint satisfaction
- 👥 **Staff Management**: Manage regular and emergency duty staff
- 📅 **Availability Tracking**: Set unavailable dates, days, and partner preferences
- 🔄 **Schedule Editing**: Manual override and regeneration capabilities
- ⚠️ **Intelligent Warnings**: Get notified about scheduling conflicts and one-sided preferences
- 📊 **Dashboard Analytics**: Real-time overview of schedules and staff
- 🌐 **Responsive Design**: Works seamlessly on desktop and mobile browsers
- 🔥 **Firebase Integration**: Cloud-based data storage and synchronization

## Key Capabilities

- **Maximum 2 duties per person per month** (hard constraint)
- **Emergency Duty Pool** (3-4 staff always available, never scheduled)
- **Date & Day-of-Week Unavailability** for each staff member
- **Partner Preferences** (general and date-specific)
- **Automatic Conflict Detection** with warnings
- **Manual Assignment Override** for any date
- **Schedule Regeneration** for new random assignments

## Tech Stack

### Frontend
- React 18 with TypeScript
- Vite for fast development
- Modern CSS with responsive design
- React Router for navigation
- Axios for API calls

### Backend
- Node.js with Express
- TypeScript
- RESTful API architecture
- Firebase Firestore for data persistence
- Intelligent scheduling algorithm

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- A Google Firebase account (free tier is sufficient)

### Installation

#### Step 1: Clone and Install Dependencies

```bash
# Install all dependencies (root, frontend, backend)
npm run install:all
```

#### Step 2: Firebase Setup

##### 2.1 Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"**
3. Enter project name (e.g., "night-duty-app")
4. Disable Google Analytics (optional)
5. Click **"Create project"**

##### 2.2 Enable Firestore Database

1. In your Firebase project, click **"Firestore Database"** in the left sidebar
2. Click **"Create database"**
3. Choose **"Start in production mode"** (recommended)
4. Select a Cloud Firestore location (choose closest to your users)
5. Click **"Enable"**

##### 2.3 Get Service Account Credentials

1. In Firebase Console, click the **gear icon** (⚙️) next to "Project Overview"
2. Select **"Project settings"**
3. Go to the **"Service accounts"** tab
4. Click **"Generate new private key"**
5. Click **"Generate key"** - this downloads a JSON file
6. **Keep this file secure!** It contains your private credentials

##### 2.4 Configure Backend Environment

1. Open the downloaded JSON file
2. Create a file `backend/.env` (copy from `backend/.env.example`)
3. Fill in the values from your JSON file:

```env
PORT=3000
NODE_ENV=development

# Firebase Configuration (from your service account JSON)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour\nPrivate\nKey\nHere\n-----END PRIVATE KEY-----\n"
```

**Important Notes:**
- Keep the quotes around `FIREBASE_PRIVATE_KEY`
- Keep the `\n` characters in the private key
- Never commit `.env` to version control (it's already in `.gitignore`)

##### 2.5 Firestore Security Rules (Optional but Recommended)

In Firebase Console, go to **Firestore Database** → **Rules** tab:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write to all authenticated users (customize as needed)
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Click **"Publish"** to save the rules.

#### Step 3: Start the Application

```bash
# Start both frontend and backend
npm run dev
```

This will start:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/api/health

### Project Structure

```
night-duty-app/
├── frontend/                      # React frontend application
│   ├── src/
│   │   ├── components/
│   │   │   ├── CalendarGrid.tsx   # Monthly calendar view
│   │   │   ├── MonthYearPicker.tsx # Month/year selector
│   │   │   ├── Layout.tsx         # App layout wrapper
│   │   │   └── Navbar.tsx         # Navigation bar
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # Main dashboard
│   │   │   ├── Staff.tsx          # Staff management
│   │   │   ├── Availability.tsx   # Availability settings
│   │   │   ├── Schedule.tsx       # Schedule generation & viewing
│   │   │   └── Reports.tsx        # Analytics & reports
│   │   ├── services/
│   │   │   └── api.ts             # API service layer
│   │   └── types/
│   │       └── index.ts           # TypeScript interfaces
│   └── ...
├── backend/                       # Express backend API
│   ├── src/
│   │   ├── config/
│   │   │   └── firebase.ts        # Firebase configuration
│   │   ├── routes/
│   │   │   ├── staff.ts           # Staff CRUD operations
│   │   │   ├── availability.ts    # Availability management
│   │   │   └── schedule.ts        # Schedule generation & management
│   │   ├── services/
│   │   │   └── scheduleGenerator.ts # Smart scheduling algorithm
│   │   ├── types/
│   │   │   └── index.ts           # TypeScript interfaces
│   │   └── server.ts              # Express app entry point
│   └── .env                       # Environment variables (create this!)
└── package.json                   # Root package file
```

## Usage Guide

### 1. Add Staff Members
- Navigate to **Staff** page
- Click **"Add Staff"**
- Enter: Name (required), Mobile (required), Email (optional)
- Check **"Emergency Duty"** for emergency staff (3-4 recommended)
- If duplicate names exist, description field appears automatically

### 2. Set Availability
- Go to **Availability** page
- Select month/year
- For each staff member, set:
  - Unavailable days of week (e.g., every Wednesday)
  - Unavailable specific dates
  - General partner preferences
  - Date-specific partner preferences

### 3. Generate Schedule
- Navigate to **Schedule** page
- Select month/year
- Click **"Generate Schedule"**
- Review warnings if any (one-sided preferences, insufficient staff)
- Schedule displays in calendar grid view

### 4. Edit Assignments
- Click edit icon on any calendar date
- Select 2 staff members from dropdown
- Save changes (marked as manually edited)

### 5. Monitor Dashboard
- View overall stats
- See emergency duty staff
- Check upcoming duties
- Identify unfilled dates

## Firestore Data Structure

```
/staff/{staffId}
  - name: string
  - mobile: string
  - email?: string
  - description?: string
  - isEmergencyDuty: boolean
  - createdAt: string

/availability/{availabilityId}
  - staffId: string
  - monthYear: string (e.g., "2025-10")
  - unavailableDates: string[]
  - unavailableDays: string[]
  - partnerPreferences: string[]
  - dateSpecificPartners: {date: string, partnerId: string}[]

/schedules/{monthYear}
  - monthYear: string
  - generatedAt: string
  - assignments: [{
      date: string
      staffIds: string[]
      staffNames: string[]
      status: 'filled' | 'unfilled' | 'partial'
      manuallyEdited: boolean
    }]
  - warnings: [{
      type: string
      message: string
      date?: string
      staffIds?: string[]
    }]
```

## Development Commands

```bash
npm run dev              # Start both frontend & backend
npm run dev:frontend     # Frontend only (port 5173)
npm run dev:backend      # Backend only (port 3000)
npm run build            # Build for production
npm run build:frontend   # Build frontend only
npm run build:backend    # Build backend only
```

## API Endpoints

### Staff
- `GET /api/staff` - Get all staff
- `GET /api/staff/emergency/list` - Get emergency duty staff
- `POST /api/staff` - Create staff
- `PUT /api/staff/:id` - Update staff
- `DELETE /api/staff/:id` - Delete staff

### Availability
- `GET /api/availability/:monthYear` - Get all availability for month
- `GET /api/availability/:monthYear/:staffId` - Get specific staff availability
- `POST /api/availability` - Create availability
- `PUT /api/availability/:id` - Update availability

### Schedule
- `POST /api/schedule/generate` - Generate monthly schedule
- `GET /api/schedule/:monthYear` - Get schedule for month
- `PUT /api/schedule/:monthYear/assignment/:date` - Update single day
- `DELETE /api/schedule/:monthYear` - Delete schedule

## Troubleshooting

### Firebase Connection Issues
- Verify `.env` file exists in `backend/` directory
- Check that `FIREBASE_PRIVATE_KEY` includes `\n` characters
- Ensure private key is wrapped in quotes
- Verify project ID matches your Firebase project

### Schedule Generation Fails
- Ensure enough regular staff (not emergency) are available
- Check availability settings aren't too restrictive
- Verify Firebase Firestore is enabled and accessible

### Module Not Found Errors
- Run `npm run install:all` again
- Delete `node_modules` folders and reinstall
- Check Node.js version (18+ required)

## License

MIT

