// Simple Firebase Debug Script
console.log('🔍 Starting simple debug...');

// Wait for Angular to be ready
setTimeout(() => {
  try {
    // Get Angular injector
    const injector = window.angular.element(document.body).injector();
    
    if (!injector) {
      console.error('❌ Angular injector not found');
      return;
    }
    
    // Get Firebase services
    const auth = injector.get('angularFireAuth');
    const firestore = injector.get('angularFirestore');
    
    console.log('✅ Firebase services found');
    
    // Check current user
    auth.authState.subscribe(user => {
      if (user) {
        console.log('✅ User logged in:', user.email);
        
        // Get users collection
        firestore.collection('users').get().subscribe(
          snapshot => {
            console.log(`📊 Found ${snapshot.size} users in Firestore`);
            
            if (snapshot.size === 0) {
              console.log('📝 Creating user in Firestore...');
              
              // Create user document
              firestore.collection('users').doc(user.uid).set({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName || '',
                createdAt: new Date(),
                lastLoginAt: new Date()
              }).then(() => {
                console.log('✅ User created in Firestore');
                console.log('🔄 Refreshing page...');
                window.location.reload();
              });
            } else {
              console.log('✅ Users already exist in Firestore');
              snapshot.forEach(doc => {
                console.log('User:', doc.data());
              });
            }
          },
          error => {
            console.error('❌ Error getting users:', error);
          }
        );
      } else {
        console.error('❌ No user logged in');
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}, 1000);

console.log('⏳ Debug script loaded, waiting for Angular...'); 