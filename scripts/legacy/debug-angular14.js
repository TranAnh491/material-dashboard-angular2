// Angular 14+ Debug Script
console.log('🔍 Starting Angular 14+ debug...');

// Wait for page to load completely
setTimeout(() => {
  try {
    // Check if Firebase is available
    if (typeof firebase === 'undefined') {
      console.error('❌ Firebase not loaded');
      return;
    }
    
    console.log('✅ Firebase loaded');
    
    // Check current user
    const user = firebase.auth().currentUser;
    if (!user) {
      console.error('❌ No user logged in');
      return;
    }
    
    console.log('✅ User logged in:', user.email);
    
    // Test Firestore access
    firebase.firestore().collection('users').get()
      .then(snapshot => {
        console.log(`📊 Found ${snapshot.size} users in Firestore`);
        
        if (snapshot.size === 0) {
          console.log('📝 Creating user in Firestore...');
          
          // Create user document
          return firebase.firestore().collection('users').doc(user.uid).set({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || '',
            createdAt: new Date(),
            lastLoginAt: new Date()
          });
        } else {
          console.log('✅ Users already exist in Firestore');
          snapshot.forEach(doc => {
            console.log('User:', doc.data());
          });
        }
      })
      .then(() => {
        console.log('✅ User created in Firestore');
        console.log('🔄 Refreshing page...');
        window.location.reload();
      })
      .catch(error => {
        console.error('❌ Error getting users:', error.message);
        
        // If permission error, show instructions
        if (error.message.includes('permission') || error.message.includes('Missing')) {
          console.log('🚨 PERMISSION ERROR - Update Firestore Rules!');
          console.log('Go to Firebase Console → Firestore → Rules');
          console.log('Replace with: allow read, write: if request.auth != null;');
        }
      });
      
  } catch (error) {
    console.error('❌ Error:', error);
  }
}, 2000);

console.log('⏳ Debug script loaded, waiting for Firebase...'); 