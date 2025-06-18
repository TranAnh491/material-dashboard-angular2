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
  
  private objects: { [key: string]: THREE.Mesh } = {};
  private originalMaterials: { [key: string]: THREE.Material | THREE.Material[] } = {};
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

    // Floor
    const floorRect = svgDoc.querySelector('rect');
    if (floorRect) {
        const floorWidth = parseFloat(floorRect.getAttribute('width'));
        const floorHeight = parseFloat(floorRect.getAttribute('height'));
        const floorGeometry = new THREE.PlaneGeometry(floorWidth * scale, floorHeight * scale);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x90ee90, side: THREE.DoubleSide });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((floorWidth / 2) * scale, 0, (floorHeight / 2) * scale);
        floor.receiveShadow = true;
        this.scene.add(floor);
    }

    // Shelves and Zones Config
    const defaultHeight = 40; 
    const tallerHeight = 60;
    const shelfColor = 0xffd580; // Light Orange
    const lightYellowColor = 0xffffeb; // Light Yellow
    const margin = 2;
    const twoDZones = ['ADMIN', 'QUALITY', 'NG', 'WO', 'IQC', 'WH OFFICE', 'VP', 'K', 'J', 'FORKLIFT', 'INBOUND STAGE', 'OUTBOUND STAGE'];
    const fiveLevelPrefixes = ['F', 'G', 'Q', 'RL', 'RR', 'SL', 'SR', 'TL', 'TR', 'UL', 'UR', 'VL', 'VR', 'WL', 'WR', 'XL', 'XR', 'YL', 'YR', 'ZL', 'ZR', 'HL', 'HR'];

    const allElements = svgDoc.querySelectorAll('g[data-loc]');
    allElements.forEach(g => {
        const rect = g.querySelector('rect');
        const textEl = g.querySelector('text');
        if (!rect) return;

        const loc = g.getAttribute('data-loc').toUpperCase();
        const width = parseFloat(rect.getAttribute('width'));
        const depth = parseFloat(rect.getAttribute('height'));
        const x = parseFloat(rect.getAttribute('x')) + width / 2;
        const z = parseFloat(rect.getAttribute('y')) + depth / 2;

        if (twoDZones.includes(loc)) {
            const currentZoneColor = (loc === 'IQC') ? shelfColor : lightYellowColor;
            const planeGeom = new THREE.PlaneGeometry(width, depth);
            const planeMat = new THREE.MeshStandardMaterial({ color: currentZoneColor, side: THREE.DoubleSide });
            const plane = new THREE.Mesh(planeGeom, planeMat);
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(x, 0.1, z);
            this.scene.add(plane);

            if (textEl && textEl.textContent) {
                const label = this.createTextSprite(textEl.textContent.trim(), 18, 'rgba(255, 255, 255, 0.8)', 'black');
                label.position.set(x, 0.2, z);
                this.scene.add(label);
            }
        } else {
            const locPrefix = loc.replace(/[0-9]/g, '');
            let currentHeight = defaultHeight;
            let levels = 0;

            if (['A', 'B', 'C', 'D', 'E'].includes(locPrefix)) {
                currentHeight = tallerHeight;
                levels = 7;
            } else if (fiveLevelPrefixes.includes(locPrefix)) {
                levels = 5;
            }
            
            const shelfWidth = width - margin;
            const shelfDepth = depth - margin;
            const geometry = new THREE.BoxGeometry(shelfWidth, currentHeight, shelfDepth);
            const material = new THREE.MeshStandardMaterial({ color: shelfColor });
            const cube = new THREE.Mesh(geometry, material);
            cube.position.set(x, currentHeight / 2, z);
            cube.castShadow = true;
            cube.receiveShadow = true;
            
            const edges = new THREE.EdgesGeometry(geometry);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
            cube.add(line);
            
            if (levels > 0) {
                const levelHeight = currentHeight / levels;
                const levelLineMaterial = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
                for (let i = 1; i < levels; i++) {
                    const yPos = (i * levelHeight) - (currentHeight / 2);
                    const points = [
                        new THREE.Vector3(-shelfWidth / 2, yPos, -shelfDepth / 2),
                        new THREE.Vector3( shelfWidth / 2, yPos, -shelfDepth / 2),
                        new THREE.Vector3( shelfWidth / 2, yPos,  shelfDepth / 2),
                        new THREE.Vector3(-shelfWidth / 2, yPos,  shelfDepth / 2),
                        new THREE.Vector3(-shelfWidth / 2, yPos, -shelfDepth / 2)
                    ];
                    const levelGeometry = new THREE.BufferGeometry().setFromPoints(points);
                    const levelLine = new THREE.Line(levelGeometry, levelLineMaterial);
                    cube.add(levelLine);
                }
            }

            this.scene.add(cube);
            this.objects[loc] = cube;
            this.originalMaterials[loc] = cube.material;

            if (textEl && textEl.textContent) {
                const label = this.createTextSprite(textEl.textContent.trim(), 36, 'rgba(0,0,0,0)', 'black');
                label.position.set(x, currentHeight + 15, z);
                this.scene.add(label);
            }
        }
    });
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
    
    const scaleFactor = 0.2; 
    sprite.scale.set(textWidth * scaleFactor, fontsize * scaleFactor, 1.0);
    
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

  private highlightShelf(shelf: THREE.Mesh): void {
      shelf.material = this.highlightedMaterial;
      const targetPosition = shelf.position.clone();
      new TWEEN.Tween(this.camera.position)
        .to({ x: targetPosition.x, y: targetPosition.y + 100, z: targetPosition.z + 150 }, 1000)
        .easing(TWEEN.Easing.Cubic.InOut).start();
      new TWEEN.Tween(this.controls.target)
        .to(targetPosition, 1000)
        .easing(TWEEN.Easing.Cubic.InOut).start();
  }

  private resetHighlights(): void {
    for (const key in this.originalMaterials) {
        if (this.objects[key]) {
            this.objects[key].material = this.originalMaterials[key];
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