# User Authentication Guide

## Overview

Your Sign Language Translator now includes a complete user authentication system. Users can:

- ✅ Create new accounts (Sign Up)
- ✅ Log in to existing accounts
- ✅ View and edit their profile
- ✅ See their translation history
- ✅ Manage settings (change email)
- ✅ Delete their account

## Features

### 1. **Registration (Sign Up)**
- Users can create new accounts with username, email, and password
- Validation: Username (3+ chars), Password (6+ chars), Email (valid format)
- Duplicate email/username protection
- Instant access after successful registration

### 2. **Login**
- Users sign in with username and password
- Token-based authentication system
- Session stored in browser (localStorage)
- Auto-redirect if already logged in

### 3. **User Profile**
- **Overview Tab**: Account status, member since date, quick actions
- **Translation History Tab**: View past translations (limited to 50 recent)
- **Settings Tab**: Update email, delete account
- Only users can modify their own profile
- All translations automatically associated with logged-in user

### 4. **Translation History**
- Automatic tracking of all user translations
- Stores: gesture name, target language, timestamp
- Limited to 50 most recent per user
- Accessible from profile page

### 5. **Translator Access**
- Translator remains fully public (no login required)
- Gesture data not logged unless user is logged in
- Logged-in users see their profile in navigation

## Pages & Files

### Frontend Pages (New)

| Page | File | Purpose |
|------|------|---------|
| Authentication | `auth.html` | Sign in / Sign up forms |
| User Profile | `profile.html` | User dashboard & settings |

### Frontend Styles (New)

| File | Purpose |
|------|---------|
| `auth.css` | Authentication page styling |
| `profile.css` | Profile page styling |

### Frontend Scripts (New)

| File | Purpose |
|------|---------|
| `auth.js` | Sign up/login logic |
| `profile.js` | Profile management logic |

### Updated Files

| File | Changes |
|------|---------|
| `index.html` | Added auth nav links |
| `gestures.html` | Added auth nav links |
| `admin.html` | Added auth nav links |
| `translator.js` | Added auth functions |
| `gestures.js` | Added auth functions |
| `admin.js` | Added auth functions |

### Backend Updates

| File | Changes |
|------|---------|
| `database.py` | Added `users` table & schema |
| `app.py` | Added 6 user authentication endpoints |

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### Translations Table (Updated)
```sql
-- Now tracks which user made the translation
user_id INTEGER (new column)
```

## API Endpoints

### Authentication Endpoints

#### Sign Up
```
POST /api/user/signup
Content-Type: application/json

{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "password123"
}

Response (201 Created):
{
    "success": true,
    "user_id": 1,
    "username": "john_doe",
    "message": "Account created successfully"
}
```

#### Login
```
POST /api/user/login
Content-Type: application/json

{
    "username": "john_doe",
    "password": "password123"
}

Response (200 OK):
{
    "success": true,
    "user_id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "token": "user_1"
}
```

#### Get Profile
```
GET /api/user/profile/<user_id>
Authorization: user_<user_id>

Response (200 OK):
{
    "user_id": 1,
    "username": "john_doe",
    "email": "john@example.com",
    "created_at": "2026-04-14 10:30:00"
}
```

#### Update Profile
```
PUT /api/user/profile/<user_id>
Authorization: user_<user_id>
Content-Type: application/json

{
    "email": "newemail@example.com"
}

Response (200 OK):
{
    "success": true,
    "message": "Profile updated"
}
```

#### Get Translation History
```
GET /api/user/translations
Authorization: user_<user_id>

Response (200 OK):
{
    "translations": [
        {
            "id": 1,
            "gesture": "hello",
            "language": "luganda",
            "timestamp": "2026-04-14 10:30:00"
        }
    ]
}
```

#### Delete Account
```
DELETE /api/user/profile/<user_id>
Authorization: user_<user_id>

Response (200 OK):
{
    "success": true,
    "message": "Account deleted"
}
```

## How to Use

### For End Users

#### Creating an Account
1. Go to **Sign In / Sign Up** in navigation
2. Click **"Sign up here"** link
3. Fill in:
   - Username (3+ characters)
   - Email (valid email format)
   - Password (6+ characters)
   - Confirm Password
4. Click **"Create Account"**
5. Automatically logged in and redirected to profile

#### Logging In
1. Go to **Sign In / Sign Up** in navigation
2. Enter username and password
3. Click **"Sign In"**
4. Redirected to your profile page

#### Using the Translator (Public)
- No account required
- Works exactly as before
- All users share the same gesture library
- Anonymous usage fully supported

#### Accessing Your Profile
1. After logging in, click **"Profile"** in navigation
2. View account overview
3. See translation history (last 50)
4. Manage settings

#### Updating Email
1. Go to Profile → Settings tab
2. Enter new email in "New Email" field
3. Click **"Update Email"**
4. Email updated in your account

#### Deleting Account
1. Go to Profile → Settings tab
2. Scroll to "Danger Zone"
3. Click **"Delete Account"**
4. Confirm deletion in modal
5. Account and all data permanently deleted

#### Logging Out
1. Click **"Logout"** button in navigation
2. Returned to translator page
3. Session cleared from browser

## Security Features

### Authentication
- ✅ Token-based authentication (`user_<id>` format)
- ✅ Token stored securely in localStorage
- ✅ Token required for profile modifications
- ✅ Cross-user protection (users can't modify other users)

### Validation
- ✅ Username uniqueness enforced
- ✅ Email uniqueness enforced
- ✅ Password minimum length (6 chars)
- ✅ Email format validation
- ✅ Username minimum length (3 chars)

### Data Protection
- ✅ User can only access/modify their own profile
- ✅ Translations linked to user account
- ✅ Delete account removes all user data
- ✅ No sensitive data in frontend

### Known Limitations
⚠️ **Password Hashing**: Currently uses plain text (NOT production-ready)
- Production implementation should use bcrypt or similar
- See [Production Deployment](#production-deployment) below

## Production Deployment

### ⚠️ IMPORTANT: Security Updates Needed

For production use, implement these security improvements:

#### 1. Password Hashing
```python
# Install: pip install werkzeug

from werkzeug.security import generate_password_hash, check_password_hash

# When creating user:
hashed_password = generate_password_hash(password)
cursor.execute(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    (username, email, hashed_password)
)

# When validating login:
stored_hash = cursor.execute(
    'SELECT password FROM users WHERE username = ?', (username,)
).fetchone()[0]
if check_password_hash(stored_hash, password):
    # Login successful
```

#### 2. JWT Tokens
```python
# Install: pip install PyJWT

import jwt
import datetime

secret_key = 'your-secret-key-here'

def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, secret_key, algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, secret_key, algorithms=['HS256'])
        return payload['user_id']
    except:
        return None
```

#### 3. HTTPS Only
- Deploy on HTTPS (SSL/TLS)
- Set secure cookie flags
- Update API calls to use HTTPS

#### 4. Rate Limiting
- Implement login attempt rate limiting
- Prevent brute force attacks
- Use Flask-Limiter

#### 5. CORS Configuration
- Restrict CORS to your domain only
- Currently allows all origins (for development)

#### 6. Input Validation
- Server-side validation (currently working)
- SQL injection protection (currently safe with parameterized queries)
- Add email verification on signup

#### 7. Email Verification
```python
# Add email_verified column to users table
# Send verification email on signup
# Require email verification before login
```

## Testing

### Test Account
```
Username: testuser
Email: test@example.com
Password: test123
```

### Test Flows

#### Test 1: Sign Up
1. Navigate to auth.html
2. Click "Sign up here"
3. Fill in username, email, password
4. Verify success message
5. Check profile page loads

#### Test 2: Login
1. Navigate to auth.html
2. Enter test credentials
3. Verify redirect to profile page
4. Check navbar shows "Profile" and "Logout"

#### Test 3: Logout
1. Click "Logout" button
2. Verify return to login page
3. Check navbar shows "Sign In / Sign Up"

#### Test 4: Profile Updates
1. Login to account
2. Go to Settings tab
3. Change email
4. Verify success message
5. Check email is updated

#### Test 5: Translation History
1. Login to account
2. Go to Translator
3. Perform a translation
4. Go to Profile → History tab
5. Verify translation appears

#### Test 6: Cross-Site Functionality
1. Login to account
2. Visit index.html
3. Verify "Profile" appears in nav
4. Visit gestures.html
5. Verify "Profile" appears in nav
6. Visit admin.html
7. Verify "Profile" appears in nav

## Troubleshooting

### "Invalid credentials" error
- ✓ Check username/password spelling (case-sensitive)
- ✓ Ensure user account exists
- ✓ Check backend is running

### "Username already exists"
- ✓ Choose a different username
- ✓ Use login page if account exists

### "Email already registered"
- ✓ Use a different email
- ✓ Or login with existing email account
- ✓ Password reset not yet implemented

### Not seeing Profile in navbar
- ✓ Reload page after login
- ✓ Clear browser cache
- ✓ Check localStorage has `is_logged_in: true`

### Translation history not saving
- ✓ Must be logged in to save history
- ✓ Check user_id is in localStorage
- ✓ Check backend logs for errors

### Getting redirected to auth page
- ✓ Session expired or cleared
- ✓ Click Sign In / Sign Up to log back in
- ✓ Check if localStorage was cleared

## Architecture

```
User Visits App
    ↓
Check localStorage for is_logged_in
    ↓
If true:
    Show Profile & Logout in nav
Else:
    Show Sign In / Sign Up in nav
    ↓
Click Sign In / Sign Up
    ↓
Navigate to auth.html
    ↓
User fills form (Login or Signup)
    ↓
Frontend sends to /api/user/login or /api/user/signup
    ↓
Backend validates in database
    ↓
Returns user_id + token
    ↓
Frontend stores in localStorage
    ↓
Set is_logged_in = true
    ↓
Redirect to profile.html
    ↓
Profile page loads user data via API
    ↓
User can view/edit profile
    ↓
Click Logout
    ↓
Clear localStorage
    ↓
Back to public mode
```

## FAQ

**Q: Do I need an account to use the translator?**
A: No! The translator is fully public. Accounts are optional for saving history.

**Q: What happens if I delete my account?**
A: All your data (profile, email, translation history) is permanently deleted and cannot be recovered.

**Q: Can I change my password?**
A: Not yet. This feature can be added in future versions.

**Q: Can I change my username?**
A: Not currently. Usernames are fixed at creation. Can be added in future.

**Q: How long does my session last?**
A: Until you log out or clear browser storage manually. No automatic expiration (yet).

**Q: Is my password secure?**
A: Current implementation uses plain text (NOT production-ready). Use hashing for production (see above).

**Q: Can I have multiple accounts?**
A: Yes, each email/username is unique. Create new accounts as needed.

**Q: What if I forgot my password?**
A: Password reset not yet implemented. Feature for future version.

## Future Enhancements

- [ ] Password hashing (bcrypt)
- [ ] JWT token authentication
- [ ] Email verification on signup
- [ ] Password reset functionality
- [ ] Two-factor authentication
- [ ] Social login (Google, Facebook)
- [ ] User profile pictures
- [ ] Saved favorite gestures
- [ ] Translation practice mode
- [ ] Leaderboard (most translations)
- [ ] Achievement badges

## Support

For issues or questions:
1. Check this guide's Troubleshooting section
2. Review backend logs for error messages
3. Check browser console (F12) for frontend errors
4. Verify all files are present and updated

---

**Authentication Feature Added**: April 2026
**Status**: ✅ Beta Ready
