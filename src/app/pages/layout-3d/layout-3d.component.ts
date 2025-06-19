import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy, NgZone, AfterViewChecked } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import * as TWEEN from '@tweenjs/tween.js';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-layout-3d',
  templateUrl: './layout-3d.component.html',
  styleUrls: ['./layout-3d.component.scss']
})
export class Layout3dComponent implements AfterViewInit, OnDestroy, AfterViewChecked {

  @ViewChild('rendererContainer', { static: true }) rendererContainer: ElementRef;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private frameId: number = null;
  
  private highlightedMaterial: THREE.Material;
  private arrowHelper: THREE.ArrowHelper;
  private hereTextSprite: THREE.Sprite;
  private securedWhShelvesPrefixes = ['Q', 'RR', 'RL', 'SR', 'SL', 'TR', 'TL', 'UR', 'UL', 'VR', 'VL', 'WR', 'WL', 'XR', 'XL', 'YR', 'YL', 'ZR', 'ZL', 'HL', 'HR'];
  private font: any;
  private threeJsInitialized = false;

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private ngZone: NgZone
  ) { }

  ngAfterViewInit(): void {
    // The view is initialized, but we will let AfterViewChecked handle the Three.js setup
    // to ensure the container is visible and has dimensions.
  }

  ngAfterViewChecked(): void {
    if (this.rendererContainer && this.rendererContainer.nativeElement.offsetParent && !this.threeJsInitialized) {
      this.threeJsInitialized = true;
      this.initThree();
      this.loadSVGAndBuildScene();
    }
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

    // Create and hide the arrow helper
    const dir = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 40;
    const hex = 0xff0000;
    this.arrowHelper = new THREE.ArrowHelper(dir, origin, length, hex, 10, 5);
    this.arrowHelper.visible = false;
    this.scene.add(this.arrowHelper);

    // Create and hide the "HERE" text sprite
    this.hereTextSprite = this.createTextSprite('HERE', 27, 'rgba(0, 0, 0, 0)', 'red');
    this.hereTextSprite.visible = false;
    this.scene.add(this.hereTextSprite);

    window.addEventListener('resize', this.onWindowResize, false);
  }

  private loadSVGAndBuildScene(): void {
    const fontLoader = new FontLoader();
    fontLoader.load('assets/fonts/helvetiker_regular.typeface.json', (loadedFont) => {
        this.font = loadedFont;
        this.http.get('assets/img/LayoutD.svg', { responseType: 'text' }).subscribe(
          svgData => {
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgData, 'image/svg+xml');
            this.createWarehouseFromSVG(svgDoc);
            if (this.font) {
                this.populateShelvesWithCodes();
            } else {
                console.error('--- DIAGNOSTICS ERROR: Font is NOT loaded. Cannot create text labels.');
            }
            this.animate();
          },
          error => console.error('Could not load SVG file', error)
        );
    });
  }

  private createWarehouseFromSVG(svgDoc: Document): void {
    const scale = 1;
    const wallHeight = 40;
    
    // Define Colors
    const lightCementGrey = 0xffffff; // Pure white for warehouse floor
    const lightGreen = 0x7CFC00; // LawnGreen - more vibrant
    const lightOrange = 0xF28500; // Tangerine
    const lightBlue = 0x007BA7; // Cerulean
    const lightRed = 0xf08080;
    const brightYellow = 0xffff00;
    const darkGreen = 0x006400;

    // Floor
    const floorRect = svgDoc.querySelector('rect');
    if (floorRect) {
        const floorWidth = parseFloat(floorRect.getAttribute('width'));
        const floorHeight = parseFloat(floorRect.getAttribute('height'));
        const floorThickness = 1.0; // 10cm
        const floorGeometry = new THREE.BoxGeometry(floorWidth * scale, floorThickness, floorHeight * scale);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: lightCementGrey, side: THREE.DoubleSide }); // Cement grey floor
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.set((floorWidth / 2) * scale, -floorThickness / 2, (floorHeight / 2) * scale);
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Add floor border on top of the new thick floor
        const borderYPosition = 0.01;
        const floorBorderGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, borderYPosition, 0),
            new THREE.Vector3(floorWidth, borderYPosition, 0),
            new THREE.Vector3(floorWidth, borderYPosition, floorHeight),
            new THREE.Vector3(0, borderYPosition, floorHeight),
            new THREE.Vector3(0, borderYPosition, 0)
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
    const twoDZones = ['ADMIN', 'QUALITY', 'NG', 'WO', 'IQC', 'WH OFFICE', 'K', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'SECURED WH'];
    const borderedZones = ['ADMIN', 'QUALITY', 'NG', 'WH OFFICE', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE', 'SECURED WH', 'K', 'WO'];
    const fiveLevelPrefixes = ['F', 'G', 'Q', 'RL', 'RR', 'SL', 'SR', 'TL', 'TR', 'UL', 'UR', 'VL', 'VR', 'WL', 'WR', 'XL', 'XR', 'YL', 'YR', 'ZL', 'ZR', 'HL', 'HR'];

    const allElements = svgDoc.querySelectorAll('g[data-loc]');
    let qualityWidth = 0;
    let qualityX = 0;

    // First pass to find Quality dimensions
    allElements.forEach(g => {
        const loc = g.getAttribute('data-loc');
        if (loc.toUpperCase() === 'QUALITY') {
            const rect = g.querySelector('rect');
            if (rect) {
                qualityWidth = parseFloat(rect.getAttribute('width'));
                qualityX = parseFloat(rect.getAttribute('x'));
            }
        }
    });

    allElements.forEach(g => {
        const rect = g.querySelector('rect');
        const textEl = g.querySelector('text');
        if (!rect) return;

        const loc = g.getAttribute('data-loc');
        const upperCaseLoc = loc.toUpperCase();
        let width = parseFloat(rect.getAttribute('width'));
        const depth = parseFloat(rect.getAttribute('height'));
        let x = parseFloat(rect.getAttribute('x')) + width / 2;
        let z = parseFloat(rect.getAttribute('y')) + depth / 2;

        if (upperCaseLoc === 'ADMIN' && qualityWidth > 0) {
            width = qualityWidth;
            x = qualityX + width / 2;
        }

        if (upperCaseLoc === 'K') {
            z += 10; // Move down by 1m (10 units)
        }

        if (twoDZones.includes(upperCaseLoc) || upperCaseLoc === 'SECURED WH') {
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

            // Add walls for specified zones
            const walledZones = ['WH OFFICE', 'SECURED WH', 'QUALITY', 'ADMIN'];
            if (walledZones.includes(upperCaseLoc)) {
                this.createWallsForZone(x, z, width, depth, wallHeight, upperCaseLoc);
            }

            // Add border for specified 2D zones
            if (borderedZones.includes(upperCaseLoc) || upperCaseLoc === 'SECURED WH') {
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
                const floorLabelZones = ['INBOUND STAGE', 'OUTBOUND STAGE', 'J', 'NG', 'ADMIN', 'WH OFFICE', 'VP', 'QUALITY', 'SECURED WH'];
                const palletZones = ['IQC', 'K', 'WO'];

                if (floorLabelZones.includes(upperCaseLoc)) {
                    const labelSize = 5; // A good size for large zone labels
                    const label = this.create3DTextLabel(displayText, labelSize, 0.5);
                    
                    if (upperCaseLoc === 'SECURED WH') {
                        // Position below the zone, standing up
                        label.position.set(x, labelSize / 2, z + depth / 2 - 10); 
                    } else {
                        // Position in the center of the zone, standing up
                        label.position.set(x, labelSize / 2, z); 
                    }
                    this.scene.add(label);
                } else if (palletZones.includes(upperCaseLoc)) {
                    this.createPalletsForZone(x, z, width, depth, 20);
                } else if (upperCaseLoc === 'FORKLIFT') {
                    const forklift = this.createForkliftModel();
                    forklift.position.set(x, 1, z);
                    forklift.rotation.y = Math.PI / 2; // Face towards the main aisles
                    this.scene.add(forklift);
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
            const isSecuredShelf = this.securedWhShelvesPrefixes.includes(locPrefix);

            if (upperCaseLoc === 'A12') {
                levels = 5;
            } else if (isSecuredShelf) {
                levels = 7;
            } else if (upperCaseLoc === 'VP') {
                levels = 6;
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
                shelfObject = this.createMultiLevelShelf(shelfWidth, shelfDepth, currentHeight, levels, baseName, labelSize, upperCaseLoc);
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
            shelfObject.userData.width = shelfWidth;
            shelfObject.userData.depth = shelfDepth;
            shelfObject.userData.height = currentHeight;
            shelfObject.userData.levels = levels;

            this.scene.add(shelfObject);
        }
    });

    this.createAisleSigns();
  }

  private createMultiLevelShelf(width: number, depth: number, height: number, levels: number, baseName: string, labelSize: number, locationName: string): THREE.Group {
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
            shelf.name = `${locationName}-level-${i}`; // Use a unique name
            const yPos = i * spacing - height / 2;
            shelf.position.set(0, yPos, 0);
            shelf.castShadow = true;
            shelf.receiveShadow = true;
            shelf.userData.originalMaterial = shelfSurfaceMaterial;
            group.add(shelf);

            // Add individual label for each level
            if (baseName && this.font) {
                const label = this.create3DTextLabel(shelfLevelName, shelfThickness * 0.8, 0.1);
                label.position.set(0, yPos + shelfThickness, 0); 
                group.add(label);
            }
        }
    }
    return group;
  }

  private create3DTextLabel(text: string, size: number, depth: number): THREE.Mesh {
    const textGeometry = new TextGeometry(text, {
        font: this.font,
        size: size,
        depth: depth,
    });

    // Center the geometry so rotation/position is predictable
    textGeometry.computeBoundingBox();
    const textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
    textGeometry.translate(-textWidth / 2, 0, 0);

    const textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const textMesh = new THREE.Mesh(textGeometry, textMaterial);
    
    return textMesh;
  }

  private createForkliftModel(): THREE.Group {
    const forkliftGroup = new THREE.Group();
    
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const operatorCabMaterial = new THREE.MeshStandardMaterial({ color: 0xFF4500 }); // OrangeRed
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x4B4B4B });
    const forkMaterial = new THREE.MeshStandardMaterial({ color: 0x2B2B2B });
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1B1B1B });

    const bodyWidth = 8, bodyHeight = 10, bodyDepth = 12;

    // Main Body
    const mainBody = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth),
        bodyMaterial
    );
    mainBody.position.y = bodyHeight / 2;
    forkliftGroup.add(mainBody);

    // Operator Cab
    const cab = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth * 0.95, bodyHeight * 0.8, bodyDepth * 0.6),
        operatorCabMaterial
    );
    cab.position.set(0, bodyHeight * 0.6, -bodyDepth * 0.2);
    mainBody.add(cab);

    // Mast
    const mastHeight = 30, mastWidth = 6, mastDepth = 2;
    const mast = new THREE.Mesh(
        new THREE.BoxGeometry(mastWidth, mastHeight, mastDepth),
        mastMaterial
    );
    mast.position.set(0, mastHeight / 2, bodyDepth / 2 + mastDepth / 2);
    mainBody.add(mast);

    // Forks
    const forkLength = 15, forkWidth = 1, forkHeight = 0.5;
    const forkY = 2;
    const forkZ = bodyDepth/2 + mastDepth + forkLength/2;
    
    const fork1 = new THREE.Mesh(new THREE.BoxGeometry(forkWidth, forkHeight, forkLength), forkMaterial);
    fork1.position.set(-mastWidth/4, forkY, forkZ);
    mainBody.add(fork1);

    const fork2 = new THREE.Mesh(new THREE.BoxGeometry(forkWidth, forkHeight, forkLength), forkMaterial);
    fork2.position.set(mastWidth/4, forkY, forkZ);
    mainBody.add(fork2);

    // Wheels
    const wheelRadius = 2.5, wheelDepth = 1.5;
    const wheelGeom = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelDepth, 20);
    const wheelPositions = [
        { x: -bodyWidth/2, y: wheelRadius, z: bodyDepth/4 },
        { x: bodyWidth/2, y: wheelRadius, z: bodyDepth/4 },
        { x: -bodyWidth/2, y: wheelRadius, z: -bodyDepth/4 },
        { x: bodyWidth/2, y: wheelRadius, z: -bodyDepth/4 },
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeom, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(pos.x, pos.y, pos.z);
        mainBody.add(wheel);
    });

    return forkliftGroup;
  }

  private createComplexPallet(width: number, depth: number, height: number): THREE.Group {
    const palletGroup = new THREE.Group();
    const palletMaterial = new THREE.MeshStandardMaterial({ color: 0x1E90FF }); // DodgerBlue

    const topDeckHeight = height * 0.15;
    const blockHeight = height * 0.7;
    const bottomSlatHeight = height * 0.15;

    // 1. Top Deck
    const topDeck = new THREE.Mesh(
        new THREE.BoxGeometry(width, topDeckHeight, depth),
        palletMaterial
    );
    topDeck.position.y = (height / 2) - (topDeckHeight / 2);
    palletGroup.add(topDeck);

    // 2. Nine Blocks
    const blockWidth = width / 4;
    const blockDepth = depth / 4;
    const blockY = topDeck.position.y - (topDeckHeight / 2) - (blockHeight / 2);
    
    const blockPositions = [
        { x: -width/2 + blockWidth/2, z: -depth/2 + blockDepth/2 },
        { x: 0, z: -depth/2 + blockDepth/2 },
        { x: width/2 - blockWidth/2, z: -depth/2 + blockDepth/2 },
        { x: -width/2 + blockWidth/2, z: 0 },
        { x: 0, z: 0 },
        { x: width/2 - blockWidth/2, z: 0 },
        { x: -width/2 + blockWidth/2, z: depth/2 - blockDepth/2 },
        { x: 0, z: depth/2 - blockDepth/2 },
        { x: width/2 - blockWidth/2, z: depth/2 - blockDepth/2 },
    ];
    
    blockPositions.forEach(pos => {
        const block = new THREE.Mesh(
            new THREE.BoxGeometry(blockWidth, blockHeight, blockDepth),
            palletMaterial
        );
        block.position.set(pos.x, blockY, pos.z);
        palletGroup.add(block);
    });

    // 3. Three Bottom Slats
    const bottomSlatY = blockY - (blockHeight / 2) - (bottomSlatHeight / 2);
    const bottomSlatGeom = new THREE.BoxGeometry(width, bottomSlatHeight, blockDepth);

    const slat1 = new THREE.Mesh(bottomSlatGeom, palletMaterial);
    slat1.position.set(0, bottomSlatY, -depth / 2 + blockDepth / 2);
    palletGroup.add(slat1);

    const slat2 = new THREE.Mesh(bottomSlatGeom, palletMaterial);
    slat2.position.set(0, bottomSlatY, 0);
    palletGroup.add(slat2);

    const slat3 = new THREE.Mesh(bottomSlatGeom, palletMaterial);
    slat3.position.set(0, bottomSlatY, depth / 2 - blockDepth / 2);
    palletGroup.add(slat3);
    
    return palletGroup;
  }

  private createPalletsForZone(centerX: number, centerZ: number, zoneWidth: number, zoneDepth: number, palletCount: number): void {
    const palletHeight = 1.0;
    const individualPalletZoneDepth = zoneDepth / palletCount;

    const palletModelWidth = zoneWidth * 0.95;
    const palletModelDepth = individualPalletZoneDepth * 0.95;

    for (let i = 0; i < palletCount; i++) {
        const pallet = this.createComplexPallet(palletModelWidth, palletModelDepth, palletHeight);

        const palletX = centerX;
        const palletY = 0.1 + (palletHeight / 2);
        const palletZ = (centerZ - zoneDepth / 2) + (i * individualPalletZoneDepth) + (individualPalletZoneDepth / 2);

        pallet.position.set(palletX, palletY, palletZ);
        
        pallet.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        this.scene.add(pallet);
    }
  }

  private createAisleSigns(): void {
    // Part A: A-G signs (on shelf front)
    const explicitSignShelves = ['A1', 'A7', 'B1', 'B7', 'C1', 'C7', 'D1', 'D7', 'E1', 'E7', 'F1', 'F7', 'G1', 'G7'];
    explicitSignShelves.forEach(shelfName => {
        const shelf = this.scene.getObjectByName(shelfName);
        if (shelf && shelf.userData.levels >= 5) {
            const { width, depth, height, levels } = shelf.userData;
            const spacing = height / (levels - 1);
            const signY = 3.5 * spacing;

            const signWidth = width * 0.9;
            const signHeight = spacing * 0.8;
            const locPrefix = shelfName.replace(/[0-9]/g, '');

            const signMesh = this.createSignMesh(locPrefix, signWidth, signHeight);
            signMesh.position.set(shelf.position.x, signY, shelf.position.z + depth / 2 + 0.1);
            this.scene.add(signMesh);

            // Add sub-signs below the main aisle sign
            let subSignText: string;
            const subSignY = signY - signHeight; // Position it right below the main sign

            if (['A', 'B', 'C'].includes(locPrefix)) {
                subSignText = 'FGs';
            } else if (['D', 'E', 'F', 'G'].includes(locPrefix)) {
                subSignText = 'Materials';
            }

            if (subSignText) {
                const subSignMesh = this.createSignMesh(subSignText, signWidth, signHeight);
                subSignMesh.position.set(shelf.position.x, subSignY, shelf.position.z + depth / 2 + 0.1);
                this.scene.add(subSignMesh);
            }
        }
    });

    // Part B: Secured WH signs are now removed.
  }

  private createWallsForZone(centerX: number, centerZ: number, zoneWidth: number, zoneDepth: number, wallHeight: number, zoneName: string): void {
    const wallThickness = 1;
    const solidMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }); // Pure white
    const glassMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        roughness: 0.1,
        metalness: 0.1
    });

    const bottomWallHeight = wallHeight * 0.1;
    const glassWallHeight = wallHeight * 0.8;
    const topWallHeight = wallHeight * 0.1;

    // Helper to create a wall section
    const createWallSegment = (width, height, depth, material, position) => {
        const segment = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        segment.position.copy(position);
        segment.receiveShadow = true;
        this.scene.add(segment);
    };

    // Back and Front Walls (with glass)
    const horizontalWallWidth = zoneWidth + wallThickness;
    const backWallZ = centerZ - zoneDepth / 2;
    const frontWallZ = centerZ + zoneDepth / 2;

    [backWallZ, frontWallZ].forEach(wallZ => {
        // Bottom
        createWallSegment(horizontalWallWidth, bottomWallHeight, wallThickness, solidMaterial, new THREE.Vector3(centerX, bottomWallHeight / 2, wallZ));
        // Glass
        createWallSegment(horizontalWallWidth, glassWallHeight, wallThickness, glassMaterial, new THREE.Vector3(centerX, bottomWallHeight + glassWallHeight / 2, wallZ));
        // Top
        createWallSegment(horizontalWallWidth, topWallHeight, wallThickness, solidMaterial, new THREE.Vector3(centerX, bottomWallHeight + glassWallHeight + topWallHeight / 2, wallZ));
    });

    // Left and Right Walls
    const verticalWallDepth = zoneDepth - wallThickness;
    const leftWallX = centerX - zoneWidth / 2;
    const rightWallX = centerX + zoneWidth / 2;

    // Left Wall (Full solid)
    createWallSegment(wallThickness, wallHeight, verticalWallDepth, solidMaterial, new THREE.Vector3(leftWallX, wallHeight / 2, centerZ));

    // Right Wall (with glass and a door for WH OFFICE)
    if (zoneName === 'WH OFFICE') {
        const doorWidth = 20; // 2m wide
        const doorHeight = 30; // 3m high
        const doorShiftUp = 50; // 5m shift "up" (-z direction) from the corner

        const wall_z_max = centerZ + verticalWallDepth / 2;
        const wall_z_min = centerZ - verticalWallDepth / 2;

        const door_z_end = wall_z_max - doorShiftUp;
        const door_z_start = door_z_end - doorWidth;

        // Wall Segment 1: "Top" part of the wall (segment closest to Secured WH)
        const segment1_depth = wall_z_max - door_z_end;
        if (segment1_depth > 0.1) {
            const segment1_centerZ = door_z_end + segment1_depth / 2;
            createWallSegment(wallThickness, bottomWallHeight, segment1_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, segment1_centerZ));
            createWallSegment(wallThickness, glassWallHeight, segment1_depth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, segment1_centerZ));
            createWallSegment(wallThickness, topWallHeight, segment1_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, segment1_centerZ));
        }
        
        // Wall Segment 2: "Bottom" part of the wall (segment farther from Secured WH)
        const segment2_depth = door_z_start - wall_z_min;
        if (segment2_depth > 0.1) {
            const segment2_centerZ = wall_z_min + segment2_depth / 2;
            createWallSegment(wallThickness, bottomWallHeight, segment2_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, segment2_centerZ));
            createWallSegment(wallThickness, glassWallHeight, segment2_depth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, segment2_centerZ));
            createWallSegment(wallThickness, topWallHeight, segment2_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, segment2_centerZ));
        }

        const lintelCenterZ = door_z_start + doorWidth / 2;

        // Part over the door (lintel)
        if (wallHeight > doorHeight) {
            const lintelHeight = wallHeight - doorHeight;
            createWallSegment(wallThickness, lintelHeight, doorWidth, solidMaterial, new THREE.Vector3(rightWallX, doorHeight + lintelHeight / 2, lintelCenterZ));
        }
        
        // Add the door itself
        const door = this.createFramedDoor(doorWidth, doorHeight, wallThickness - 0.2);
        door.position.set(rightWallX, doorHeight / 2, lintelCenterZ);
        this.scene.add(door);

    } else if (zoneName === 'SECURED WH') {
        const doorWidth = 20; // 2m
        const doorHeight = 30; // 3m
        
        const wall_z_max = centerZ + verticalWallDepth / 2;
        const wall_z_min = centerZ - verticalWallDepth / 2;
        
        // Bottom door
        const bottomDoor_z_start = wall_z_min + 10;
        const bottomDoor_z_end = bottomDoor_z_start + doorWidth;

        // Top door
        const topDoor_z_end = wall_z_max - 10;
        const topDoor_z_start = topDoor_z_end - doorWidth;

        const createGlassPillar = (pillarDepth, pillarCenterZ) => {
            createWallSegment(wallThickness, bottomWallHeight, pillarDepth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, pillarCenterZ));
            createWallSegment(wallThickness, glassWallHeight, pillarDepth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, pillarCenterZ));
            createWallSegment(wallThickness, topWallHeight, pillarDepth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, pillarCenterZ));
        };

        // Create wall segments (pillars) around doors
        // 1. Bottom-most pillar
        const pillar1_depth = bottomDoor_z_start - wall_z_min;
        if (pillar1_depth > 0.1) {
            createGlassPillar(pillar1_depth, wall_z_min + pillar1_depth / 2);
        }
        
        // 2. Middle pillar
        const middlePillarDepth = topDoor_z_start - bottomDoor_z_end;
        if (middlePillarDepth > 0.1) {
            createGlassPillar(middlePillarDepth, bottomDoor_z_end + middlePillarDepth / 2);
        }
        
        // 3. Top-most pillar
        const pillar3_depth = wall_z_max - topDoor_z_end;
        if (pillar3_depth > 0.1) {
            createGlassPillar(pillar3_depth, topDoor_z_end + pillar3_depth / 2);
        }

        // Create lintels over doors
        const lintelHeight = wallHeight - doorHeight;
        if (lintelHeight > 0) {
            createWallSegment(wallThickness, lintelHeight, doorWidth, solidMaterial, new THREE.Vector3(rightWallX, doorHeight + lintelHeight/2, bottomDoor_z_start + doorWidth/2));
            createWallSegment(wallThickness, lintelHeight, doorWidth, solidMaterial, new THREE.Vector3(rightWallX, doorHeight + lintelHeight/2, topDoor_z_start + doorWidth/2));
        }

        // Create door meshes
        const bottomDoor = this.createFramedDoor(doorWidth, doorHeight, wallThickness - 0.2);
        bottomDoor.position.set(rightWallX, doorHeight/2, bottomDoor_z_start + doorWidth/2);
        this.scene.add(bottomDoor);
        
        const topDoor = this.createFramedDoor(doorWidth, doorHeight, wallThickness - 0.2);
        topDoor.position.set(rightWallX, doorHeight/2, topDoor_z_start + doorWidth/2);
        this.scene.add(topDoor);

    } else if (zoneName === 'ADMIN' || zoneName === 'QUALITY') {
        const doorWidth = 20;
        const doorHeight = 30;

        // Door is in the middle of the right wall
        const wall_z_min = centerZ - verticalWallDepth / 2;
        const wall_z_max = centerZ + verticalWallDepth / 2;
        const door_z_start = centerZ - doorWidth / 2;
        const door_z_end = centerZ + doorWidth / 2;

        // Wall segment 1 (before door)
        const segment1_depth = door_z_start - wall_z_min;
        if (segment1_depth > 0.1) {
            const segment1_centerZ = wall_z_min + segment1_depth / 2;
            createWallSegment(wallThickness, bottomWallHeight, segment1_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, segment1_centerZ));
            createWallSegment(wallThickness, glassWallHeight, segment1_depth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, segment1_centerZ));
            createWallSegment(wallThickness, topWallHeight, segment1_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, segment1_centerZ));
        }

        // Wall segment 2 (after door)
        const segment2_depth = wall_z_max - door_z_end;
        if (segment2_depth > 0.1) {
            const segment2_centerZ = door_z_end + segment2_depth / 2;
            createWallSegment(wallThickness, bottomWallHeight, segment2_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, segment2_centerZ));
            createWallSegment(wallThickness, glassWallHeight, segment2_depth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, segment2_centerZ));
            createWallSegment(wallThickness, topWallHeight, segment2_depth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, segment2_centerZ));
        }

        // Lintel
        const lintelHeight = wallHeight - doorHeight;
        if (lintelHeight > 0) {
            createWallSegment(wallThickness, lintelHeight, doorWidth, solidMaterial, new THREE.Vector3(rightWallX, doorHeight + lintelHeight/2, centerZ));
        }

        // Door
        const door = this.createFramedDoor(doorWidth, doorHeight, wallThickness - 0.2);
        door.position.set(rightWallX, doorHeight/2, centerZ);
        this.scene.add(door);

    } else {
        // Default wall with glass
        createWallSegment(wallThickness, bottomWallHeight, verticalWallDepth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight / 2, centerZ));
        createWallSegment(wallThickness, glassWallHeight, verticalWallDepth, glassMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight / 2, centerZ));
        createWallSegment(wallThickness, topWallHeight, verticalWallDepth, solidMaterial, new THREE.Vector3(rightWallX, bottomWallHeight + glassWallHeight + topWallHeight / 2, centerZ));
    }
  }

  private createFramedDoor(width: number, height: number, depth: number): THREE.Group {
    const doorGroup = new THREE.Group();
    const frameThickness = 1.0; 

    const glassMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, transparent: true, opacity: 0.2, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide
    });
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });

    // Glass panel (slightly thinner than the frame)
    const glassPanel = new THREE.Mesh(
        new THREE.BoxGeometry(depth * 0.5, height - (2 * frameThickness), width - (2 * frameThickness)),
        glassMaterial
    );
    doorGroup.add(glassPanel);

    // Frame
    const top = new THREE.Mesh(new THREE.BoxGeometry(depth, frameThickness, width), frameMaterial);
    top.position.y = height / 2 - frameThickness / 2;
    doorGroup.add(top);

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(depth, frameThickness, width), frameMaterial);
    bottom.position.y = -height / 2 + frameThickness / 2;
    doorGroup.add(bottom);

    const left = new THREE.Mesh(new THREE.BoxGeometry(depth, height - (2 * frameThickness), frameThickness), frameMaterial);
    left.position.z = -width / 2 + frameThickness / 2;
    doorGroup.add(left);
    
    const right = new THREE.Mesh(new THREE.BoxGeometry(depth, height - (2 * frameThickness), frameThickness), frameMaterial);
    right.position.z = width / 2 - frameThickness / 2;
    doorGroup.add(right);

    doorGroup.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    return doorGroup;
  }

  // Helper function to create sign meshes
  private createSignMesh(text: string, width: number, height: number): THREE.Mesh {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // Use a higher resolution canvas for sharper text
    canvas.width = 1024;
    canvas.height = 512;

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'black';

    // Dynamically adjust font size to fit the text
    let fontSize = 400; // Start with a large font size
    context.font = `bold ${fontSize}px Arial`;
    
    const padding = 40;
    while (context.measureText(text).width > canvas.width - padding) {
        fontSize -= 5;
        context.font = `bold ${fontSize}px Arial`;
    }

    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const signMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true });
    const signGeometry = new THREE.PlaneGeometry(width, height);
    return new THREE.Mesh(signGeometry, signMaterial);
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
    const directFind = this.scene.getObjectByName(upperCaseCode);
    if (directFind) {
      this.highlightShelf(directFind);
      return;
    }

    // If not found directly, assume it's an item code and search the Google Apps Script.
    const sheetUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
    this.http.get<any[]>(sheetUrl).subscribe((data: any[]) => {
      if (!data || data.length === 0) {
        this.snackBar.open(`No data found from item list.`, 'Close', { duration: 3000 });
        return;
      }

      const foundRow = data.find(row => row.code && String(row.code).trim().toUpperCase() === upperCaseCode);
      if (foundRow && foundRow.location) {
        const location = String(foundRow.location).trim().toUpperCase();
        console.log(`Item '${code}' found via Apps Script. Target location: '${location}'`);

        let shelfOrLevel: THREE.Object3D | undefined;

        // Try direct match first (for whole shelves like 'G1' or zones)
        shelfOrLevel = this.scene.getObjectByName(location);

        // If not found, parse it as Bay + Level (e.g., F62 -> bay F6, level 2)
        if (!shelfOrLevel) {
            const levelStr = location.slice(-1);
            if (levelStr.match(/\d/)) { // Check if last char is a digit
                const level = parseInt(levelStr, 10);
                const bayName = location.slice(0, -1);
                const bayObject = this.scene.getObjectByName(bayName);
                if (bayObject && level > 0) {
                    const levelObjectName = `${bayName}-level-${level - 1}`;
                    console.log(`Direct match failed for '${location}'. Trying parsed name: '${levelObjectName}' inside '${bayName}'`);
                    // getObjectByName searches children, which is what we want.
                    shelfOrLevel = bayObject.getObjectByName(levelObjectName) || bayObject;
                }
            }
        }
        
        if (shelfOrLevel) {
          console.log('Successfully found object in 3D scene:', shelfOrLevel);
          this.highlightShelf(shelfOrLevel);
        } else {
          this.snackBar.open(`Item found at '${location}', but location not in 3D model.`, 'Close', { duration: 3000 });
        }
      } else {
        this.snackBar.open(`Mã hàng '${code}' không có.`, 'Close', { duration: 3000 });
      }
    }, error => {
        console.error('Error fetching from Google Apps Script:', error);
        this.snackBar.open('Error connecting to item database.', 'Close', { duration: 3000 });
    });
  }

  private highlightShelf(shelf: THREE.Object3D): void {
    console.log(`HIGHLIGHTING object: ${shelf.name}`, shelf);
    shelf.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.material = this.highlightedMaterial;
      }
    });

    const targetPosition = new THREE.Vector3();
    shelf.getWorldPosition(targetPosition);

    // Position and show the arrow
    this.arrowHelper.position.set(targetPosition.x, targetPosition.y + 50, targetPosition.z);
    this.arrowHelper.visible = true;

    // Position and show the "HERE" text sprite just above the arrow's tail
    this.hereTextSprite.position.set(targetPosition.x, this.arrowHelper.position.y + 15, targetPosition.z);
    this.hereTextSprite.visible = true;
  }

  private resetHighlights(): void {
    console.log('Resetting all highlights...');

    this.arrowHelper.visible = false;
    this.hereTextSprite.visible = false;

    this.scene.traverse(child => {
      if (child instanceof THREE.Mesh && child.userData.originalMaterial) {
        if (child.material !== child.userData.originalMaterial) {
          child.material = child.userData.originalMaterial;
        }
      }
    });
  }

  private animateFrameCount = 0;
  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    // Log only once every 60 frames to avoid spamming the console
    if (this.animateFrameCount % 60 === 0) {
      // console.log(`Animate loop running. Frame: ${this.animateFrameCount}`);
    }
    this.animateFrameCount++;
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

  private populateShelvesWithCodes(): void {
    const sheetUrl = 'https://script.google.com/macros/s/AKfycbzyU7xVxyjixJfOgPCA1smMtVfcLXyKDLPrNz2T6fiLrreHX8CQsArJgQ6LSR5pTviZGA/exec';
    this.http.get<any[]>(sheetUrl).subscribe((data: any[]) => {
      if (!data || data.length === 0) {
        console.warn(`No data found from Google Apps Script.`);
        return;
      }
      const itemsByLocation = data.reduce((acc, item) => {
        const location = item.location ? String(item.location).trim().toUpperCase() : null;
        if (location && item.code) {
          if (!acc[location]) {
            acc[location] = [];
          }
          acc[location].push(String(item.code).trim().toUpperCase());
        }
        return acc;
      }, {});
      this.ngZone.run(() => {
        this.placeItemCodesOnShelves(itemsByLocation);
      });
    }, error => console.error('Error fetching from Google Apps Script for shelf population:', error));
  }

  private placeItemCodesOnShelves(itemsByLocation: { [key: string]: string[] }): void {
    const targetDataLocation = 'G11'; 
    const targetShelfObject = 'G1'; // The actual 3D object to attach to

    if (itemsByLocation[targetDataLocation]) {
      const shelf = this.scene.getObjectByName(targetShelfObject);
      if (shelf && shelf.userData.width && shelf.userData.depth && shelf.userData.height) {
        const items = itemsByLocation[targetDataLocation];
        const shelfWidth = shelf.userData.width;
        const shelfHeight = shelf.userData.height;
        const shelfDepth = shelf.userData.depth;
        const cols = 10;
        const textHeight = 4;
        const cellWidth = shelfWidth / cols;
        items.forEach((itemCode, index) => {
          const label = this.create3DTextLabel(itemCode, 1.2, 0.1);
          const col = index % cols;
          const row = Math.floor(index / cols);
          const x = (col * cellWidth) - (shelfWidth / 2) + (cellWidth / 2);
          const y = (row * textHeight) - (shelfHeight / 2) + (textHeight / 2);
          const z = shelfDepth / 2 - 5;
          
          const localPosition = new THREE.Vector3(x, y, z);
          const worldPosition = shelf.localToWorld(localPosition.clone());
          
          label.position.copy(worldPosition);
          this.scene.add(label); // Add to the scene directly
        });
      }
    }
  }
} 