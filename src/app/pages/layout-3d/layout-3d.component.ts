import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HttpClient } from '@angular/common/http';
import { GoogleSheetService } from 'app/services/google-sheet.service';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

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
  private font: any;
  
  private objects: { [key: string]: THREE.Object3D } = {};
  private highlightedMaterial: THREE.Material;

  constructor(
    private http: HttpClient,
    private googleSheetService: GoogleSheetService
  ) { }

  ngAfterViewInit(): void {
    setTimeout(() => {
        this.initThree();
        this.loadFontAndBuildScene();
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

  private loadFontAndBuildScene(): void {
    const fontLoader = new FontLoader();
    fontLoader.load('assets/fonts/helvetiker_regular.typeface.json', (font) => {
        this.font = font;
        this.loadSVGAndBuildScene();
    });
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
    const zoneColors = {
        'DEFAULT': 0xeeeeee,
        'FLOOR': 0xbbbbbb, // Vibrant Grey
        'BORDER': 0x000000,
        // 2D Zones
        'WH OFFICE': 0x32CD32, // LimeGreen
        'UNNAMED OFFICE': 0x32CD32, // LimeGreen
        'QUALITY': 0x32CD32, // LimeGreen
        'J': 0x32CD32, // LimeGreen
        'INBOUND STAGE': 0x32CD32, // LimeGreen
        'K': 0x32CD32, // LimeGreen
        'ADMIN': 0xaaaaaa, // Lighter Grey
        'FORKLIFT': 0xFF8C00, // DarkOrange
        'OUTBOUND STAGE': 0x1E90FF, // DodgerBlue
        'NG': 0xFF4500, // OrangeRed
        'IQC': 0xFFD700, // Gold
        'WO': 0x228B22, // ForestGreen
    };

    // Floor
    const floorRect = svgDoc.querySelector('rect');
    if (floorRect) {
        const floorWidth = parseFloat(floorRect.getAttribute('width'));
        const floorHeight = parseFloat(floorRect.getAttribute('height'));
        const floorGeometry = new THREE.PlaneGeometry(floorWidth * scale, floorHeight * scale);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: zoneColors['FLOOR'], side: THREE.DoubleSide });
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
        const floorBorderMaterial = new THREE.LineBasicMaterial({ color: zoneColors['BORDER'] });
        const floorBorder = new THREE.Line(floorBorderGeometry, floorBorderMaterial);
        this.scene.add(floorBorder);
    }

    // Shelves and Zones Constants
    const defaultHeight = 40; 
    const tallerHeight = 60;
    const margin = 2;
    const twoDZones = ['ADMIN', 'QUALITY', 'NG', 'WO', 'IQC', 'WH OFFICE', 'VP', 'K', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'UNNAMED OFFICE'];
    const borderedZones = ['ADMIN', 'QUALITY', 'NG', 'WH OFFICE', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'UNNAMED OFFICE', 'K', 'WO'];
    const fiveLevelPrefixes = ['F', 'G', 'Q', 'RL', 'RR', 'SL', 'SR', 'TL', 'TR', 'UL', 'UR', 'VL', 'VR', 'WL', 'WR', 'XL', 'XR', 'YL', 'YR', 'ZL', 'ZR', 'HL', 'HR'];

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
            const zoneColor = zoneColors[upperCaseLoc] || zoneColors['DEFAULT'];
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
                const borderMaterial = new THREE.LineBasicMaterial({ color: zoneColors['BORDER'] });
                const borderLine = new THREE.Line(borderGeometry, borderMaterial);
                borderLine.position.set(x, 0.15, z); // Slightly above the plane
                this.scene.add(borderLine);
            }

            if (textEl && textEl.textContent) {
                if (upperCaseLoc === 'INBOUND STAGE') {
                    const text = 'Inbound Stage';
                    const textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
                    const textGeometry = new TextGeometry(text, {
                        font: this.font,
                        size: 30, // 150% of 20
                        depth: 2,
                    });
                    textGeometry.computeBoundingBox();
                    const textMesh = new THREE.Mesh(textGeometry, textMaterial);

                    // Center the text
                    const textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
                    textMesh.position.set(x - textWidth / 2, 2, z); // Stand on the ground
                    
                    this.scene.add(textMesh);

                } else {
                    const displayText = (upperCaseLoc === 'WH OFFICE') ? 'WH Office' : textEl.textContent.trim();
                    const label = this.createTextSprite(displayText, 20, 'rgba(255, 255, 255, 0.7)', 'black');
                    label.position.set(x, 0.2, z);
                    this.scene.add(label);
                }
            }
        } else {
            // 3D Shelves
            let currentHeight = defaultHeight;
            let levels = 0;

            // Special case for A12 shelf, which is inside the office
            if (upperCaseLoc === 'A12') {
                currentHeight = defaultHeight;
                levels = 5;
            } else {
                // General rules for other shelves based on their prefix
                const locPrefix = upperCaseLoc.replace(/[0-9]/g, '');
                if (['A', 'B', 'C', 'D', 'E'].includes(locPrefix)) {
                    currentHeight = tallerHeight;
                    levels = 7;
                } else if (fiveLevelPrefixes.includes(locPrefix)) {
                    levels = 5;
                }
            }
            
            const shelfWidth = width - margin;
            const shelfDepth = depth - margin;
            
            let shelfObject: THREE.Object3D;
            const baseName = textEl ? textEl.textContent.trim() : '';

            if (levels > 0) {
                shelfObject = this.createMultiLevelShelf(shelfWidth, shelfDepth, currentHeight, levels, baseName);
            } else {
                // Create a solid box for shelves without levels
                const material = new THREE.MeshStandardMaterial({ color: 0xffa500 }); // Vibrant Orange
                const geometry = new THREE.BoxGeometry(shelfWidth, currentHeight, shelfDepth);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.originalMaterial = material; // Store for resetting highlights
                shelfObject = mesh;

                // Add a single label for solid shelves if they have a name
                if (baseName) {
                    const label = this.createTextSprite(baseName, 40, 'rgba(0,0,0,0)', 'black');
                    label.position.set(0, currentHeight / 2 + 15, 0);
                    shelfObject.add(label);
                }
            }
            
            shelfObject.position.set(x, currentHeight / 2, z);
            shelfObject.userData.isShelf = true;
            shelfObject.userData.shelfName = upperCaseLoc;
            this.objects[upperCaseLoc] = shelfObject;
            this.scene.add(shelfObject);
        }
    });
  }

  private createMultiLevelShelf(width: number, depth: number, height: number, levels: number, baseName: string): THREE.Group {
    const shelfGroup = new THREE.Group();

    // Vibrant Shelf Colors
    const postColor = 0xFFA500; // Vibrant Orange
    const surfaceColor = 0x40E0D0; // Turquoise

    const postRadius = 1;
    const postHeight = height;
    const postGeometry = new THREE.CylinderGeometry(postRadius, postRadius, postHeight, 8);
    const postMaterial = new THREE.MeshStandardMaterial({ color: postColor });

    // Positions for the four corner posts
    const postPositions = [
        new THREE.Vector3(width / 2 - postRadius, 0, depth / 2 - postRadius),
        new THREE.Vector3(-width / 2 + postRadius, 0, depth / 2 - postRadius),
        new THREE.Vector3(width / 2 - postRadius, 0, -depth / 2 + postRadius),
        new THREE.Vector3(-width / 2 + postRadius, 0, -depth / 2 + postRadius),
    ];
    postPositions.forEach(pos => {
        const post = new THREE.Mesh(postGeometry, postMaterial);
        post.position.copy(pos);
        post.castShadow = true;
        post.receiveShadow = true;
        post.userData.originalMaterial = postMaterial; // Store for reset
        shelfGroup.add(post);
    });

    const surfaceHeight = 0.5;
    const surfaceGeometry = new THREE.BoxGeometry(width, surfaceHeight, depth);
    const surfaceMaterial = new THREE.MeshStandardMaterial({ color: surfaceColor });

    for (let i = 1; i <= levels; i++) {
        const levelY = (i * (height / (levels + 1))) - (height / 2) + surfaceHeight;
        const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
        surface.position.set(0, levelY, 0);
        surface.castShadow = true;
        surface.receiveShadow = true;
        shelfGroup.add(surface);

        // Add tier-specific label
        const tierName = `${baseName}${i}`;
        const label = this.createTextSprite(tierName, 12, 'rgba(0,0,0,0)', 'black');

        // Position the label at the front-center of the shelf tier
        const labelY = levelY + (surfaceHeight / 2) + 6;
        const labelZ = depth / 2 + 1; // Position in front of the shelf
        label.position.set(0, labelY, labelZ);
        shelfGroup.add(label);
    }
    
    shelfGroup.userData.isMultiLevel = true;
    return shelfGroup;
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
    
    // Direct search for shelf
    if (this.objects[upperCaseCode]) {
        this.highlightShelf(this.objects[upperCaseCode]);
        return;
    }
    
    // Search by item code in Google Sheet
    const searchRange = 'Inventory!A:B';
    this.googleSheetService.getSheet(searchRange).subscribe((response: any) => {
      const rows = response.values;
      if (!rows) return;
      
      const foundRow = rows.find(row => row[0] && row[0].toUpperCase() === upperCaseCode);
      if (foundRow && foundRow[1]) {
        const location = foundRow[1].toUpperCase();
        const shelf = this.objects[location];
        if (shelf) {
          this.highlightShelf(shelf);
        } else {
          console.warn(`Item found at '${location}', but shelf not in 3D model.`);
        }
      } else {
        console.warn(`Item code '${code}' not found.`);
      }
    }, error => console.error('Error fetching from Google Sheet:', error));
  }

  private highlightShelf(shelf: THREE.Object3D): void {
      shelf.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.material = this.highlightedMaterial;
        }
      });
      const targetPosition = shelf.position.clone();
      new TWEEN.Tween(this.camera.position)
        .to({ x: targetPosition.x, y: targetPosition.y + 100, z: targetPosition.z + 150 }, 1000)
        .easing(TWEEN.Easing.Cubic.InOut).start();
      new TWEEN.Tween(this.controls.target)
        .to(targetPosition, 1000)
        .easing(TWEEN.Easing.Cubic.InOut).start();
  }

  private resetHighlights(): void {
    for (const key in this.objects) {
        const shelfObject = this.objects[key];
        if (shelfObject) {
            shelfObject.traverse(child => {
                if (child instanceof THREE.Mesh && child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
            });
        }
    }
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