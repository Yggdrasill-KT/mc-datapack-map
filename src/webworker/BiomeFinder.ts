/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
export { };

import { Climate, DensityFunction, WorldgenRegistries, Identifier, Holder, NoiseGeneratorSettings, RandomState, NoiseParameters, BiomeSource } from "deepslate"

interface StartConfig {
	seed: bigint,
	biomeSourceJson: unknown,
	noiseGeneratorSettingsJson: unknown,
	densityFunctions: { [key: string]: unknown },
	noises: { [key: string]: unknown },
	maxRadius: number,
	sampleStep: number,
	maxY: number,
	allBiomes: string[]
}

interface BiomeLocation {
	x: number,
	z: number,
	distance: number
}

let cancelRequested = false

function* spiralGenerator(maxRadius: number, step: number) {
	yield { x: 0, z: 0 }
	let x = 0, z = 0
	let dx = 0, dz = -step

	while (Math.abs(x) <= maxRadius || Math.abs(z) <= maxRadius) {
		if (Math.abs(x) <= maxRadius && Math.abs(z) <= maxRadius) {
			yield { x, z }
		}

		if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
			[dx, dz] = [-dz, dx]  // 90 degree rotation
		}

		x += dx
		z += dz
	}
}

function searchBiomes(config: StartConfig) {
	cancelRequested = false

	// Initialize registries
	WorldgenRegistries.DENSITY_FUNCTION.clear()
	for (const id in config.densityFunctions) {
		const df = new DensityFunction.HolderHolder(Holder.parser(WorldgenRegistries.DENSITY_FUNCTION, DensityFunction.fromJson)(config.densityFunctions[id]))
		WorldgenRegistries.DENSITY_FUNCTION.register(Identifier.parse(id), df)
	}

	WorldgenRegistries.NOISE.clear()
	for (const id in config.noises) {
		const noise = NoiseParameters.fromJson(config.noises[id])
		WorldgenRegistries.NOISE.register(Identifier.parse(id), noise)
	}

	// Initialize BiomeSource and Sampler
	const biomeSource = BiomeSource.fromJson(config.biomeSourceJson)
	const noiseGeneratorSettings = NoiseGeneratorSettings.fromJson(config.noiseGeneratorSettingsJson)
	const randomState = new RandomState(noiseGeneratorSettings, config.seed)
	const sampler = Climate.Sampler.fromRouter(randomState.router)

	const biomeMap = new Map<string, BiomeLocation>()
	const totalExpected = config.allBiomes.length

	let sampleCount = 0
	const batchSize = 1000

	const spiral = spiralGenerator(config.maxRadius, config.sampleStep)

	for (const { x, z } of spiral) {
		if (cancelRequested) {
			postMessage({
				type: "cancelled"
			})
			return
		}

		// Sample biome at this position (at max Y, using block coordinates >> 2 for biome coordinates)
		const biome = biomeSource.getBiome(x >> 2, config.maxY >> 2, z >> 2, sampler).toString()
		const distance = Math.sqrt(x * x + z * z)

		// Record first occurrence only
		if (!biomeMap.has(biome) && config.allBiomes.includes(biome)) {
			biomeMap.set(biome, { x, z, distance })

			// Check if all biomes found (early exit)
			if (biomeMap.size === totalExpected) {
				const biomes: { [key: string]: BiomeLocation } = {}
				for (const [key, value] of biomeMap.entries()) {
					biomes[key] = value
				}

				postMessage({
					type: "complete",
					biomes: biomes,
					completed: true
				})
				return
			}
		}

		sampleCount++

		// Send progress update every batch
		if (sampleCount % batchSize === 0) {
			const foundBiomes: Array<{ biome: string, x: number, z: number, distance: number }> = []
			for (const [biome, location] of biomeMap.entries()) {
				foundBiomes.push({ biome, ...location })
			}

			postMessage({
				type: "progress",
				progress: Math.round((biomeMap.size / totalExpected) * 100),
				foundBiomes: foundBiomes,
				totalFound: biomeMap.size,
				totalExpected: totalExpected
			})
		}
	}

	// Search completed without finding all biomes
	const biomes: { [key: string]: BiomeLocation } = {}
	for (const [key, value] of biomeMap.entries()) {
		biomes[key] = value
	}

	postMessage({
		type: "complete",
		biomes: biomes,
		completed: false
	})
}

self.onmessage = (evt: ExtendableMessageEvent) => {
	if (evt.data.type === "start") {
		searchBiomes(evt.data.config)
	} else if (evt.data.type === "cancel") {
		cancelRequested = true
	}
}
