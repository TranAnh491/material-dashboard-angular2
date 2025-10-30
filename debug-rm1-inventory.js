// Script debug để kiểm tra vấn đề RM1 Inventory không trừ đúng
// Chạy trong console browser khi ở trang RM1 Inventory

async function debugRM1InventoryIssue() {
  console.log('🔍 Debugging RM1 Inventory update issue...');
  
  try {
    // 1. Kiểm tra dữ liệu Outbound
    console.log('\n📦 === CHECKING OUTBOUND DATA ===');
    const outboundSnapshot = await firebase.firestore()
      .collection('outbound-materials')
      .where('factory', '==', 'ASM1')
      .limit(10)
      .get();
    
    console.log(`📊 Found ${outboundSnapshot.size} outbound records for ASM1`);
    
    if (!outboundSnapshot.empty) {
      console.log('\n📋 Outbound Records:');
      outboundSnapshot.forEach((doc, index) => {
        const data = doc.data();
        console.log(`  ${index + 1}. ID: ${doc.id}`);
        console.log(`     Material: ${data.materialCode}`);
        console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
        console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
        console.log(`     ExportQuantity: ${data.exportQuantity}`);
        console.log(`     ExportDate: ${data.exportDate}`);
        console.log(`     Location: ${data.location}`);
        console.log('     ---');
      });
    }
    
    // 2. Kiểm tra dữ liệu Inventory
    console.log('\n📦 === CHECKING INVENTORY DATA ===');
    const inventorySnapshot = await firebase.firestore()
      .collection('inventory-materials')
      .where('factory', '==', 'ASM1')
      .limit(10)
      .get();
    
    console.log(`📊 Found ${inventorySnapshot.size} inventory records for ASM1`);
    
    if (!inventorySnapshot.empty) {
      console.log('\n📋 Inventory Records:');
      inventorySnapshot.forEach((doc, index) => {
        const data = doc.data();
        console.log(`  ${index + 1}. ID: ${doc.id}`);
        console.log(`     Material: ${data.materialCode}`);
        console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
        console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
        console.log(`     Quantity: ${data.quantity}`);
        console.log(`     Exported: ${data.exported}`);
        console.log(`     Location: ${data.location}`);
        console.log('     ---');
      });
    }
    
    // 3. Tìm matching records
    console.log('\n🔍 === FINDING MATCHING RECORDS ===');
    const outboundRecords = [];
    const inventoryRecords = [];
    
    outboundSnapshot.forEach(doc => {
      outboundRecords.push({ id: doc.id, ...doc.data() });
    });
    
    inventorySnapshot.forEach(doc => {
      inventoryRecords.push({ id: doc.id, ...doc.data() });
    });
    
    let matchCount = 0;
    let noMatchCount = 0;
    
    outboundRecords.forEach(outbound => {
      console.log(`\n🔍 Checking outbound: ${outbound.materialCode} - PO: "${outbound.poNumber}"`);
      
      const matches = inventoryRecords.filter(inventory => {
        const materialMatch = inventory.materialCode === outbound.materialCode;
        const poMatch = inventory.poNumber === outbound.poNumber;
        
        // Check import date match
        let importDateMatch = false;
        if (outbound.importDate && inventory.importDate) {
          let outboundDate = '';
          let inventoryDate = '';
          
          // Parse outbound import date
          if (outbound.importDate.toDate) {
            outboundDate = outbound.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
          } else {
            outboundDate = outbound.importDate.toString();
          }
          
          // Parse inventory import date
          if (inventory.importDate.toDate) {
            inventoryDate = inventory.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
          } else {
            inventoryDate = inventory.importDate.toString();
          }
          
          importDateMatch = outboundDate === inventoryDate;
        }
        
        return materialMatch && poMatch && importDateMatch;
      });
      
      if (matches.length > 0) {
        matchCount++;
        console.log(`  ✅ FOUND ${matches.length} matching inventory records:`);
        matches.forEach(match => {
          console.log(`    - Inventory ID: ${match.id}`);
          console.log(`    - Current Exported: ${match.exported || 0}`);
          console.log(`    - Outbound Export: ${outbound.exportQuantity || outbound.quantity || 0}`);
        });
      } else {
        noMatchCount++;
        console.log(`  ❌ NO matching inventory records found`);
        console.log(`    - Checking available inventory for material ${outbound.materialCode}:`);
        
        const materialMatches = inventoryRecords.filter(inv => inv.materialCode === outbound.materialCode);
        if (materialMatches.length > 0) {
          console.log(`    - Found ${materialMatches.length} records with same material:`);
          materialMatches.forEach(match => {
            console.log(`      * PO: "${match.poNumber}" vs "${outbound.poNumber}"`);
            console.log(`      * ImportDate: ${match.importDate} vs ${outbound.importDate}`);
          });
        } else {
          console.log(`    - No inventory records found for material ${outbound.materialCode}`);
        }
      }
    });
    
    console.log(`\n📊 === SUMMARY ===`);
    console.log(`✅ Matching records: ${matchCount}`);
    console.log(`❌ No match records: ${noMatchCount}`);
    
    // 4. Kiểm tra logic update
    console.log('\n🔧 === TESTING UPDATE LOGIC ===');
    if (matchCount > 0) {
      console.log('💡 Logic should work for matching records');
      console.log('💡 Check if updateExportedFromOutboundFIFO is being called');
      console.log('💡 Check if updateInventoryExported is being called');
    } else {
      console.log('⚠️ No matching records found - this explains why inventory is not updating');
      console.log('💡 Possible issues:');
      console.log('   - PO Number format mismatch');
      console.log('   - Import Date format mismatch');
      console.log('   - Missing inventory records');
      console.log('   - Data type issues');
    }
    
  } catch (error) {
    console.error('❌ Error during debug:', error);
  }
}

// Chạy debug
debugRM1InventoryIssue();

// Helper function để test specific material
async function testSpecificMaterial(materialCode, poNumber) {
  console.log(`🧪 Testing specific material: ${materialCode} - PO: ${poNumber}`);
  
  try {
    // Check outbound
    const outboundQuery = await firebase.firestore()
      .collection('outbound-materials')
      .where('factory', '==', 'ASM1')
      .where('materialCode', '==', materialCode)
      .where('poNumber', '==', poNumber)
      .get();
    
    console.log(`📦 Outbound records: ${outboundQuery.size}`);
    outboundQuery.forEach(doc => {
      const data = doc.data();
      console.log(`  - Export: ${data.exportQuantity || data.quantity}, Date: ${data.exportDate}`);
    });
    
    // Check inventory
    const inventoryQuery = await firebase.firestore()
      .collection('inventory-materials')
      .where('factory', '==', 'ASM1')
      .where('materialCode', '==', materialCode)
      .where('poNumber', '==', poNumber)
      .get();
    
    console.log(`📦 Inventory records: ${inventoryQuery.size}`);
    inventoryQuery.forEach(doc => {
      const data = doc.data();
      console.log(`  - Quantity: ${data.quantity}, Exported: ${data.exported}, Current: ${(data.quantity || 0) - (data.exported || 0)}`);
    });
    
  } catch (error) {
    console.error('❌ Error testing material:', error);
  }
}

console.log('📝 Available functions:');
console.log('  - debugRM1InventoryIssue()');
console.log('  - testSpecificMaterial("MATERIAL_CODE", "PO_NUMBER")');

