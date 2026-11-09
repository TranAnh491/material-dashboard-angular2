/**
 * Script to delete all ASM2 inventory data from Firebase
 * Run this in browser console when logged into the app
 */

async function deleteASM2Inventory() {
  console.log('🚀 Starting ASM2 inventory deletion...');
  
  try {
    // Check if Firebase is available
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase not available. Make sure you are logged into the app.');
    }
    
    const firestore = firebase.firestore();
    const collectionRef = firestore.collection('materials-inventory');
    
    // Query all ASM2 documents
    console.log('📋 Querying ASM2 inventory items...');
    const querySnapshot = await collectionRef.where('factory', '==', 'ASM2').get();
    
    if (querySnapshot.empty) {
      console.log('✅ No ASM2 inventory items found to delete.');
      return { success: true, deleted: 0, message: 'No ASM2 items found' };
    }
    
    console.log(`📦 Found ${querySnapshot.size} ASM2 inventory items to delete`);
    
    // Delete in batches (Firebase limit: 500 operations per batch)
    const batchSize = 500;
    const docs = querySnapshot.docs;
    let deletedCount = 0;
    
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = firestore.batch();
      const currentBatch = docs.slice(i, i + batchSize);
      
      console.log(`🗑️ Preparing batch ${Math.floor(i/batchSize) + 1} (${currentBatch.length} items)...`);
      
      currentBatch.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Execute batch delete
      await batch.commit();
      deletedCount += currentBatch.length;
      
      console.log(`✅ Deleted batch ${Math.floor(i/batchSize) + 1} - Total deleted: ${deletedCount}/${docs.length}`);
      
      // Add small delay between batches to avoid rate limiting
      if (i + batchSize < docs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`🎉 Successfully deleted ${deletedCount} ASM2 inventory items!`);
    
    return {
      success: true,
      deleted: deletedCount,
      message: `Successfully deleted ${deletedCount} ASM2 inventory items`
    };
    
  } catch (error) {
    console.error('❌ Error deleting ASM2 inventory:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to delete ASM2 inventory'
    };
  }
}

// Helper function to confirm deletion
async function confirmDeleteASM2() {
  const confirmed = confirm(
    '⚠️ WARNING: This will permanently delete ALL ASM2 inventory data!\n\n' +
    'This action CANNOT be undone.\n\n' +
    'Are you sure you want to continue?'
  );
  
  if (!confirmed) {
    console.log('❌ Deletion cancelled by user');
    return;
  }
  
  const doubleConfirm = confirm(
    '🔥 FINAL CONFIRMATION 🔥\n\n' +
    'Type "DELETE ASM2" in the next prompt to confirm deletion.'
  );
  
  if (!doubleConfirm) {
    console.log('❌ Deletion cancelled by user');
    return;
  }
  
  const typeConfirm = prompt('Type "DELETE ASM2" to confirm:');
  if (typeConfirm !== 'DELETE ASM2') {
    console.log('❌ Deletion cancelled - incorrect confirmation text');
    return;
  }
  
  // Proceed with deletion
  const result = await deleteASM2Inventory();
  
  if (result.success) {
    alert(`✅ Success: ${result.message}`);
  } else {
    alert(`❌ Error: ${result.message}`);
  }
  
  return result;
}

// Usage instructions
console.log(`
🗑️ ASM2 INVENTORY DELETION SCRIPT

To delete all ASM2 inventory data, run:
confirmDeleteASM2()

⚠️ WARNING: This action is irreversible!

Or run directly (without confirmation):
deleteASM2Inventory()
`);
