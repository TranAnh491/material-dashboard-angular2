import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HttpClient } from '@angular/common/http';
import * as TWEEN from '@tweenjs/tween.js'
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-layout-3d',
  templateUrl: './layout-3d.component.html',
  styleUrls: ['./layout-3d.component.scss']
})
export class Layout3dComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('rendererContainer', { static: true }) rendererContainer: ElementRef;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;

  private frameId: number = null;
  private objects: { [key: string]: THREE.Mesh } = {};
  private originalMaterials: { [key: string]: THREE.Material | THREE.Material[] } = {};
  private highlightedMaterial: THREE.Material;

  constructor(private http: HttpClient) { }

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.initThree();
    this.loadSVGAndBuildScene();
    this.animate();
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
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 5000);
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

    // Materials
    this.highlightedMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });

    window.addEventListener('resize', this.onWindowResize, false);
  }

  private loadSVGAndBuildScene(): void {
    this.http.get('assets/img/LayoutD.svg', { responseType: 'text' }).subscribe(
      svgData => {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgData, 'image/svg+xml');
        this.createWarehouseFromSVG(svgDoc);
      },
      error => console.error('Could not load SVG file', error)
    );
  }

  private createWarehouseFromSVG(svgDoc: Document): void {
    const scale = 1;
    const defaultHeight = 40;
    const shelfColor = 0x996633; // Brown color for shelves

    // Floor
    const floorRect = svgDoc.querySelector('rect');
    if (floorRect) {
        const floorWidth = parseFloat(floorRect.getAttribute('width'));
        const floorHeight = parseFloat(floorRect.getAttribute('height'));
        const floorGeometry = new THREE.PlaneGeometry(floorWidth * scale, floorHeight * scale);
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((floorWidth / 2) * scale, 0, (floorHeight / 2) * scale);
        floor.receiveShadow = true;
        this.scene.add(floor);
    }

    const allElements = svgDoc.querySelectorAll('g[data-loc]');
    allElements.forEach(g => {
        const rect = g.querySelector('rect');
        const textEl = g.querySelector('text');
        if (!rect) return;

        const loc = g.getAttribute('data-loc');
        const width = parseFloat(rect.getAttribute('width'));
        const depth = parseFloat(rect.getAttribute('height'));
        const x = parseFloat(rect.getAttribute('x')) + width / 2;
        const z = parseFloat(rect.getAttribute('y')) + depth / 2;

        const geometry = new THREE.BoxGeometry(width, defaultHeight, depth);
        const material = new THREE.MeshStandardMaterial({ color: shelfColor });

        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(x, defaultHeight / 2, z);
        cube.castShadow = true;
        cube.receiveShadow = true;
        
        // Add edges for visual separation
        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
        cube.add(line);

        this.scene.add(cube);
        this.objects[loc] = cube;
        this.originalMaterials[loc] = cube.material;

        // Add text label
        if (textEl && textEl.textContent) {
            const label = this.createTextSprite(textEl.textContent.trim());
            label.position.set(x, defaultHeight + 15, z);
            this.scene.add(label);
        }
    });
  }

  private createTextSprite(message: string): THREE.Sprite {
    const fontface = 'Arial';
    const fontsize = 36;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `Bold ${fontsize}px ${fontface}`;
    
    // Set background color
    context.fillStyle = 'rgba(255, 255, 255, 0.7)';
    // Set text color
    context.strokeStyle = 'black';
    context.lineWidth = 4;

    const metrics = context.measureText(message);
    const textWidth = metrics.width;

    context.strokeText(message, 0, fontsize);
    context.fillText(message, 0, fontsize);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(textWidth/4, fontsize/4, 1.0);
    
    return sprite;
  }

  public findShelf(code: string): void {
    if (!code) return;

    // Reset previously highlighted object
    for (const key in this.originalMaterials) {
        if (this.objects[key]) {
            this.objects[key].material = this.originalMaterials[key];
        }
    }

    const shelf = this.objects[code.toUpperCase()];
    if (shelf) {
      shelf.material = this.highlightedMaterial;

      // Animate camera to focus on the object
      const targetPosition = shelf.position.clone();
      new TWEEN.Tween(this.camera.position)
        .to({
            x: targetPosition.x,
            y: targetPosition.y + 100, 
            z: targetPosition.z + 150 
        }, 1000)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();
        
      new TWEEN.Tween(this.controls.target)
        .to(targetPosition, 1000)
        .easing(TWEEN.Easing.Cubic.InOut)
        .start();

    } else {
      console.warn(`Shelf with code '${code}' not found.`);
      // Optionally, show a user-friendly message here
    }
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    TWEEN.update();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onWindowResize = (): void => {
    const container = this.rendererContainer.nativeElement;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }
} 