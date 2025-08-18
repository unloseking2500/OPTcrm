// Simple icon generation script
const fs = require('fs');
const path = require('path');

// Create SVG icons with different sizes
const createIcon = (size, outputPath) => {
  const halfSize = size / 2;
  const strokeWidth = Math.max(1, size / 32);
  
  // Create SVG content
  const svgContent = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${strokeWidth}" y="${strokeWidth}" width="${size - strokeWidth * 2}" height="${size - strokeWidth * 2}" 
        fill="#f57c00" stroke="#e65100" stroke-width="${strokeWidth}" rx="5" ry="5" />
  <text x="${halfSize}" y="${halfSize + size/10}" font-family="Arial" font-size="${size/2}" 
        font-weight="bold" text-anchor="middle" fill="white">R</text>
</svg>`;

  // Write to file
  fs.writeFileSync(outputPath, svgContent);
  console.log(`Created icon: ${outputPath}`);
};

// Create icons in different sizes
createIcon(16, path.join(__dirname, 'icon16.svg'));
createIcon(48, path.join(__dirname, 'icon48.svg'));
createIcon(128, path.join(__dirname, 'icon128.svg'));

console.log('Icon generation complete');
