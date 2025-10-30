// Script để sửa logic matching giữa Outbound và Inventory
// Chạy trong console browser

async function fixRM1InventoryMatching() {
  console.log('🔧 Fixing RM1 Inventory matching logic...');
  
  try {
    // 1. Lấy tất cả outbound records
    const outboundSnapshot = await firebase.firestore()
      .collection('outbound-materials')
      .where('factory', '==', 'ASM1')
      .get();
    
    console.log(`📦 Found ${outboundSnapshot.size} outbound records`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    // 2. Xử lý từng outbound record
    for (const outboundDoc of outboundSnapshot.docs) {
      try {
        const outboundData = outboundDoc.data();
        const materialCode = outboundData.materialCode;
        const poNumber = outboundData.poNumber;
        const exportQuantity = outboundData.exportQuantity || outboundData.quantity || 0;
        
        console.log(`\n🔍 Processing: ${materialCode} - PO: ${poNumber} - Export: ${exportQuantity}`);
        
        // 3. Tìm inventory records tương ứng
        const inventorySnapshot = await firebase.firestore()
          .collection('inventory-materials')
          .where('factory', '==', 'ASM1')
          .where('materialCode', '==', materialCode)
          .get();
        
        if (inventorySnapshot.empty) {
          console.log(`  ⚠️ No inventory records found for ${materialCode}`);
          continue;
        }
        
        console.log(`  📦 Found ${inventorySnapshot.size} inventory records for ${materialCode}`);
        
        // 4. Tìm record khớp nhất
        let bestMatch = null;
        let bestScore = 0;
        
        inventorySnapshot.forEach(inventoryDoc => {
          const inventoryData = inventoryDoc.data();
          let score = 0;
          
          // PO Number match (exact)
          if (inventoryData.poNumber === poNumber) {
            score += 100;
          }
          // PO Number match (normalized)
          else {
            const normalizedPO1 = (inventoryData.poNumber || '').replace(/[^a-zA-Z0-9]/g, '');
            const normalizedPO2 = (poNumber || '').replace(/[^a-zA-Z0-9]/g, '');
            if (normalizedPO1 === normalizedPO2) {
              score += 50;
            }
          }
          
          // Import Date match
          if (outboundData.importDate && inventoryData.importDate) {
            let outboundDate = '';
            let inventoryDate = '';
            
            // Parse outbound date
            if (outboundData.importDate.toDate) {
              outboundDate = outboundData.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              outboundDate = outboundData.importDate.toString();
            }
            
            // Parse inventory date
            if (inventoryData.importDate.toDate) {
              inventoryDate = inventoryData.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              inventoryDate = inventoryData.importDate.toString();
            }
            
            if (outboundDate === inventoryDate) {
              score += 50;
            }
          }
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { doc: inventoryDoc, data: inventoryData, score };
          }
        });
        
        if (bestMatch && bestScore >= 50) {
          console.log(`  ✅ Best match found (score: ${bestScore}):`);
          console.log(`    - Inventory ID: ${bestMatch.doc.id}`);
          console.log(`    - PO: "${bestMatch.data.poNumber}"`);
          console.log(`    - Current exported: ${bestMatch.data.exported || 0}`);
          console.log(`    - Adding export: +${exportQuantity}`);
          
          // 5. Cập nhật inventory
          const newExported = (bestMatch.data.exported || 0) + exportQuantity;
          
          await bestMatch.doc.ref.update({
            exported: newExported,
            lastExportDate: new Date(),
            lastUpdated: new Date()
          });
          
          console.log(`  ✅ Updated exported: ${bestMatch.data.exported || 0} → ${newExported}`);
          fixedCount++;
          
        } else {
          console.log(`  ❌ No suitable match found (best score: ${bestScore})`);
          
          // 6. Tạo inventory record mới nếu cần
          if (bestScore === 0) {
            console.log(`  💡 Creating new inventory record...`);
            
            const newInventoryData = {
              materialCode: materialCode,
              poNumber: poNumber,
              factory: 'ASM1',
              quantity: 0,
              exported: exportQuantity,
              openingStock: 0,
              xt: 0,
              location: 'AUTO-CREATED',
              importDate: outboundData.importDate || new Date(),
              createdAt: new Date(),
              lastUpdated: new Date(),
              lastExportDate: new Date(),
              notes: `Auto-created from outbound export on ${new Date().toISOString()}`
            };
            
            await firebase.firestore()
              .collection('inventory-materials')
              .add(newInventoryData);
            
            console.log(`  ✅ Created new inventory record`);
            fixedCount++;
          }
        }
        
      } catch (error) {
        console.error(`❌ Error processing outbound record ${outboundDoc.id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`\n📊 === FIX SUMMARY ===`);
    console.log(`✅ Fixed records: ${fixedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📦 Total outbound records: ${outboundSnapshot.size}`);
    
    if (fixedCount > 0) {
      console.log(`\n🎉 Inventory matching fixed! Refresh the RM1 Inventory page to see changes.`);
    }
    
  } catch (error) {
    console.error('❌ Error fixing inventory matching:', error);
  }
}

// Helper function để test fix cho một material cụ thể
async function testFixForMaterial(materialCode, poNumber) {
  console.log(`🧪 Testing fix for: ${materialCode} - PO: ${poNumber}`);
  
  try {
    // Find outbound record
    const outboundQuery = await firebase.firestore()
      .collection('outbound-materials')
      .where('factory', '==', 'ASM1')
      .where('materialCode', '==', materialCode)
      .where('poNumber', '==', poNumber)
      .get();
    
    if (outboundQuery.empty) {
      console.log('❌ No outbound record found');
      return;
    }
    
    const outboundDoc = outboundQuery.docs[0];
    const outboundData = outboundDoc.data();
    
    console.log('📦 Outbound data:', {
      materialCode: outboundData.materialCode,
      poNumber: outboundData.poNumber,
      exportQuantity: outboundData.exportQuantity || outboundData.quantity,
      importDate: outboundData.importDate
    });
    
    // Find inventory records
    const inventoryQuery = await firebase.firestore()
      .collection('inventory-materials')
      .where('factory', '==', 'ASM1')
      .where('materialCode', '==', materialCode)
      .get();
    
    console.log(`📦 Found ${inventoryQuery.size} inventory records`);
    
    inventoryQuery.forEach((doc, index) => {
      const data = doc.data();
      console.log(`  ${index + 1}. ID: ${doc.id}`);
      console.log(`     PO: "${data.poNumber}"`);
      console.log(`     ImportDate: ${data.importDate}`);
      console.log(`     Exported: ${data.exported || 0}`);
      console.log(`     Available: ${(data.quantity || 0) - (data.exported || 0)}`);
    });
    
  } catch (error) {
    console.error('❌ Error testing fix:', error);
  }
}

console.log('📝 Available functions:');
console.log('  - fixRM1InventoryMatching() - Fix all inventory matching issues');
console.log('  - testFixForMaterial("MATERIAL_CODE", "PO_NUMBER") - Test fix for specific material');

