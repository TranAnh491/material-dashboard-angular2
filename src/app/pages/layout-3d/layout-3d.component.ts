import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';
import { HttpClient } from '@angular/common/http';
import { GoogleSheetService } from 'app/services/google-sheet.service';

@Component({
  selector: 'app-layout-3d',
  templateUrl: './layout-3d.component.html',
  styleUrls: ['./layout-3d.component.scss']
})
export class Layout3dComponent implements AfterViewInit, OnDestroy {

  @ViewChild('rendererContainer', { static: true }) rendererContainer: ElementRef;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private frameId: number = null;
  
  private highlightedMaterial: THREE.Material;

  constructor(
    private http: HttpClient,
    private googleSheetService: GoogleSheetService
  ) { }

  ngAfterViewInit(): void {
    setTimeout(() => {
        this.initThree();
        this.loadSVGAndBuildScene();
    }, 0);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    if (this.frameId != null) {
      cancelAnimationFrame(this.frameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  private initThree(): void {
    const container = this.rendererContainer.nativeElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 10000);
    this.camera.position.set(150, 400, 600); 

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(150, 0, 250);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(200, 500, 300);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);
    
    this.highlightedMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x555500 });

    window.addEventListener('resize', this.onWindowResize, false);
  }

  private loadSVGAndBuildScene(): void {
    this.http.get('assets/img/LayoutD.svg', { responseType: 'text' }).subscribe(
      svgData => {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgData, 'image/svg+xml');
        this.createWarehouseFromSVG(svgDoc);
        this.animate();
      },
      error => console.error('Could not load SVG file', error)
    );
  }

  private createWarehouseFromSVG(svgDoc: Document): void {
    const scale = 1;
    
    // Define Colors
    const lightCementGrey = 0xd3d3d3;
    const lightGreen = 0x90ee90;
    const lightOrange = 0xffd580;
    const lightBlue = 0xadd8e6;
    const lightRed = 0xf08080;
    const brightYellow = 0xffff00;
    const darkGreen = 0x006400;

    // Floor
    const floorRect = svgDoc.querySelector('rect');
    if (floorRect) {
        const floorWidth = parseFloat(floorRect.getAttribute('width'));
        const floorHeight = parseFloat(floorRect.getAttribute('height'));
        const floorGeometry = new THREE.PlaneGeometry(floorWidth * scale, floorHeight * scale);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: lightCementGrey, side: THREE.DoubleSide }); // Cement grey floor
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((floorWidth / 2) * scale, 0, (floorHeight / 2) * scale);
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Add floor border
        const floorBorderGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0.1, 0),
            new THREE.Vector3(floorWidth, 0.1, 0),
            new THREE.Vector3(floorWidth, 0.1, floorHeight),
            new THREE.Vector3(0, 0.1, floorHeight),
            new THREE.Vector3(0, 0.1, 0)
        ]);
        const floorBorderMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
        const floorBorder = new THREE.Line(floorBorderGeometry, floorBorderMaterial);
        this.scene.add(floorBorder);
    }

    // Shelves and Zones Constants
    const defaultHeight = 40; 
    const tallerHeight = 60;
    const shelfColor = 0xffd580; // This is now also the forklift color
    const margin = 2;
    const twoDZones = ['ADMIN', 'QUALITY', 'NG', 'WO', 'IQC', 'WH OFFICE', 'VP', 'K', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'SECURED WH'];
    const borderedZones = ['ADMIN', 'QUALITY', 'NG', 'WH OFFICE', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'SECURED WH', 'K', 'WO'];
    const fiveLevelPrefixes = ['F', 'G', 'Q', 'RL', 'RR', 'SL', 'SR', 'TL', 'TR', 'UL', 'UR', 'VL', 'VR', 'WL', 'WR', 'XL', 'XR', 'YL', 'YR', 'ZL', 'ZR', 'HL', 'HR'];
    const securedWhShelvesPrefixes = ['Q', 'RR', 'RL', 'SR', 'SL', 'TR', 'TL', 'UR', 'UL', 'VR', 'VL', 'WR', 'WL', 'XR', 'XL', 'YR', 'YL', 'ZR', 'ZL', 'HL', 'HR'];

    const allElements = svgDoc.querySelectorAll('g[data-loc]');
    allElements.forEach(g => {
        const rect = g.querySelector('rect');
        const textEl = g.querySelector('text');
        if (!rect) return;

        const loc = g.getAttribute('data-loc');
        const upperCaseLoc = loc.toUpperCase();
        const width = parseFloat(rect.getAttribute('width'));
        const depth = parseFloat(rect.getAttribute('height'));
        const x = parseFloat(rect.getAttribute('x')) + width / 2;
        const z = parseFloat(rect.getAttribute('y')) + depth / 2;

        if (twoDZones.includes(upperCaseLoc)) {
            // 2D Zones
            let zoneColor;
            switch(upperCaseLoc) {
                case 'WH OFFICE':
                case 'SECURED WH':
                case 'QUALITY':
                case 'J':
                case 'INBOUND STAGE':
                case 'K':
                    zoneColor = lightGreen;
                    break;
                case 'ADMIN':
                    zoneColor = lightCementGrey;
                    break;
                case 'FORKLIFT':
                    zoneColor = lightOrange;
                    break;
                case 'OUTBOUND STAGE':
                    zoneColor = lightBlue;
                    break;
                case 'NG':
                    zoneColor = lightRed;
                    break;
                case 'IQC':
                    zoneColor = brightYellow;
                    break;
                case 'WO':
                    zoneColor = darkGreen;
                    break;
                default:
                    zoneColor = 0xeeeeee; // Fallback for zones like VP
            }
            const planeGeom = new THREE.PlaneGeometry(width, depth);
            const planeMat = new THREE.MeshStandardMaterial({ color: zoneColor, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(planeGeom, planeMat);
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(x, 0.1, z);
            this.scene.add(plane);

            // Add border for specified 2D zones
            if (borderedZones.includes(upperCaseLoc)) {
                const borderPoints = [
                    new THREE.Vector3(-width / 2, 0, -depth / 2),
                    new THREE.Vector3( width / 2, 0, -depth / 2),
                    new THREE.Vector3( width / 2, 0,  depth / 2),
                    new THREE.Vector3(-width / 2, 0,  depth / 2),
                    new THREE.Vector3(-width / 2, 0, -depth / 2)
                ];
                const borderGeometry = new THREE.BufferGeometry().setFromPoints(borderPoints);
                const borderMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
                const borderLine = new THREE.Line(borderGeometry, borderMaterial);
                borderLine.position.set(x, 0.15, z); // Slightly above the plane
                this.scene.add(borderLine);
            }

            if (textEl && textEl.textContent) {
                const displayText = (upperCaseLoc === 'WH OFFICE') ? 'WH Office' : textEl.textContent.trim();
                const floorLabelZones = ['INBOUND STAGE', 'OUTBOUND STAGE', 'FORKLIFT', 'J', 'NG', 'K', 'WO', 'IQC', 'QUALITY', 'ADMIN', 'WH OFFICE', 'VP'];

                if (floorLabelZones.includes(upperCaseLoc)) {
                    const label = this.createFloorLabel(displayText, width, depth);
                    label.rotation.x = -Math.PI / 2;
                    label.position.set(x, 0.15, z); // Place it slightly above the zone plane
                    this.scene.add(label);
                } else {
                    const label = this.createTextSprite(displayText, 20, 'rgba(255, 255, 255, 0.7)', 'black');
                    label.position.set(x, 0.2, z);
                    this.scene.add(label);
                }
            }
        } else {
            // 3D Shelves
            const locPrefix = upperCaseLoc.replace(/[0-9]/g, '');
            let currentHeight = defaultHeight;
            let levels = 0;
            const isSecuredShelf = securedWhShelvesPrefixes.includes(locPrefix) || upperCaseLoc === 'A12';

            if (upperCaseLoc === 'A12') {
                levels = 5;
            } else if (['A', 'B', 'C', 'D', 'E'].includes(locPrefix)) {
                currentHeight = tallerHeight;
                levels = 7;
            } else if (fiveLevelPrefixes.includes(locPrefix)) {
                levels = 5;
            }
            
            const shelfWidth = width - margin;
            const shelfDepth = depth - margin;
            
            let shelfObject: THREE.Object3D;
            const baseName = textEl ? textEl.textContent.trim() : '';

            if (levels > 0) {
                const labelSize = isSecuredShelf ? 16 : 24;
                shelfObject = this.createMultiLevelShelf(shelfWidth, shelfDepth, currentHeight, levels, baseName, labelSize);
            } else {
                // Create a solid box for shelves without levels
                const material = new THREE.MeshStandardMaterial({ color: shelfColor });
                const geometry = new THREE.BoxGeometry(shelfWidth, currentHeight, shelfDepth);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.originalMaterial = material; // Store for resetting highlights
                shelfObject = mesh;

                // Add a single label for solid shelves if they have a name
                if (baseName) {
                    const labelSize = isSecuredShelf ? 20 : 40;
                    const label = this.createTextSprite(baseName, labelSize, 'rgba(0,0,0,0)', 'black');
                    label.position.set(0, currentHeight / 2 + 15, 0);
                    shelfObject.add(label);
                }
            }
            
            shelfObject.name = upperCaseLoc; // Assign name for searching
            shelfObject.position.set(x, currentHeight / 2, z);

            this.scene.add(shelfObject);
        }
    });
  }

  private createMultiLevelShelf(width: number, depth: number, height: number, levels: number, baseName: string, labelSize: number): THREE.Group {
    const group = new THREE.Group();
    const postSize = 1.5;
    const shelfThickness = 0.5;

    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xffa500 }); // Orange
    const shelfSurfaceMaterial = new THREE.MeshStandardMaterial({ color: 0x1e90ff }); // DodgerBlue

    // 4 Vertical Posts
    const postGeometry = new THREE.BoxGeometry(postSize, height, postSize);
    const postPositions = [
        new THREE.Vector3(width / 2 - postSize / 2, 0, depth / 2 - postSize / 2),
        new THREE.Vector3(-width / 2 + postSize / 2, 0, depth / 2 - postSize / 2),
        new THREE.Vector3(width / 2 - postSize / 2, 0, -depth / 2 + postSize / 2),
        new THREE.Vector3(-width / 2 + postSize / 2, 0, -depth / 2 + postSize / 2),
    ];
    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.copy(pos);
        post.castShadow = true;
        post.receiveShadow = true;
        post.userData.originalMaterial = postMaterial; // Store for reset
        group.add(post);
    });

    // Horizontal Shelf Surfaces with individual labels
    if (levels > 1) {
        const shelfGeometry = new THREE.BoxGeometry(width, shelfThickness, depth);
        const spacing = height / (levels - 1);
        for (let i = 0; i < levels; i++) {
            const shelfLevelName = `${baseName}${i + 1}`;
            const shelf = new THREE.Mesh(shelfGeometry, shelfSurfaceMaterial);
            shelf.name = shelfLevelName; // Assign name for searching individual levels
            const yPos = i * spacing - height / 2;
            shelf.position.set(0, yPos, 0);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            shelf.userData.originalMaterial = shelfSurfaceMaterial;
            group.add(shelf);

            // Add individual label for each level
            if (baseName) {
                const label = this.createTextSprite(shelfLevelName, labelSize, 'rgba(0,0,0,0)', 'black');
                
                const labelHeight = label.scale.y;
                const labelY = yPos + shelfThickness / 2 + labelHeight / 2; // Place its base on the surface
                const labelX = 0; // Centered horizontally
                const labelZ = 0; // Centered along the length
                
                label.position.set(labelX, labelY, labelZ);
                group.add(label);
            }
        }
    }
    return group;
  }

  private createFloorLabel(message: string, planeWidth: number, planeDepth: number): THREE.Mesh {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // Normalize font size based on plane width to keep visual size consistent.
    // The smaller the plane, the larger the font on the texture.
    // We use a base fontsize of 50 for a reference plane width of 100.
    const fontsize = (30 * 100) / planeWidth;
    
    context.font = `Bold ${fontsize}px Arial`;
    
    // Keep canvas resolution consistent, but maintain aspect ratio of the target plane.
    canvas.width = 1024;
    canvas.height = 1024 * (planeDepth / planeWidth);

    context.font = `Bold ${fontsize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'black';
    context.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true
    });

    const geometry = new THREE.PlaneGeometry(planeWidth, planeDepth);
    const mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }

  private createTextSprite(message: string, fontsize: number, backgroundColor: string, textColor: string): THREE.Sprite {
    const fontface = 'Arial';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `Bold ${fontsize}px ${fontface}`;
    
    const metrics = context.measureText(message);
    const textWidth = metrics.width;
    
    canvas.width = textWidth + 8;
    canvas.height = fontsize + 8;
    
    context.font = `Bold ${fontsize}px ${fontface}`;
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = textColor;
    context.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    
    // Scale sprite to a fixed size in world units
    const desiredHeight = 5.0; // Set label height to 5 units
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(desiredHeight * aspect, desiredHeight, 1.0);
    
    return sprite;
  }

  public findShelf(code: string): void {
    if (!code) return;
    this.resetHighlights();
    const upperCaseCode = code.toUpperCase();

    // First, try to find the object directly in the scene by its name.
    // This could be a whole shelf group ('G1') or a specific level ('G15').
    const directFind = this.scene.getObjectByName(upperCaseCode);
    if (directFind) {
      this.highlightShelf(directFind);
      return;
    }

    // If not found directly, assume it's an item code and search the Google Sheet.
    const searchRange = 'Inventory!A:B';
    this.googleSheetService.getSheet(searchRange).subscribe((response: any) => {
      const rows = response.values;
      if (!rows || rows.length === 0) {
        console.warn(`No data found in Google Sheet or failed to parse.`);
        return;
      }

      const foundRow = rows.find(row => row[0] && row[0].toUpperCase() === upperCaseCode);
      if (foundRow && foundRow[1]) {
        const location = foundRow[1].toUpperCase().trim();
        console.log(`Item '${code}' found in Sheet. Target location: '${location}'`);

        const shelfOrLevel = this.scene.getObjectByName(location);

        if (shelfOrLevel) {
          console.log('Successfully found object in 3D scene:', shelfOrLevel);
          this.highlightShelf(shelfOrLevel);
        } else {
          console.error(`Item found at location '${location}', but this location object was not found in the 3D model.`);
        }
      } else {
        console.warn(`Item code '${code}' not found in Google Sheet.`);
      }
    }, error => console.error('Error fetching from Google Sheet:', error));
  }

  private highlightShelf(shelf: THREE.Object3D): void {
    shelf.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.material = this.highlightedMaterial;
      }
    });

    const targetPosition = new THREE.Vector3();
    shelf.getWorldPosition(targetPosition); // Get world position

    new TWEEN.Tween(this.camera.position)
      .to({ x: targetPosition.x, y: targetPosition.y + 100, z: targetPosition.z + 150 }, 1000)
      .easing(TWEEN.Easing.Cubic.InOut).start();
    new TWEEN.Tween(this.controls.target)
      .to(targetPosition, 1000)
      .easing(TWEEN.Easing.Cubic.InOut).start();
  }

  private resetHighlights(): void {
    this.scene.traverse(child => {
      if (child instanceof THREE.Mesh && child.userData.originalMaterial) {
        child.material = child.userData.originalMaterial;
      }
    });
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    TWEEN.update();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize = (): void => {
    if(this.camera && this.renderer) {
        const container = this.rendererContainer.nativeElement;
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }
  }
} 