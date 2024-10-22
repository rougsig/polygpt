import {resolve} from 'node:path'
import {readPackageJSON} from 'pkg-types'
import nodeExternals from 'rollup-plugin-node-externals'
import {merge} from 'ts-deepmerge'
import {ConfigEnv, UserConfig} from 'vite'
import dts from 'vite-plugin-dts'
import tsconfigPaths from 'vite-tsconfig-paths'

const findInternalPackages = async (root: string) => {
  const visited = new Map<string, string>()

  const queue: string[] = []
  queue.push(root)
  while (queue.length > 0) {
    const dirname = queue.shift()
    if (dirname == null) continue

    const packageJsonPath = resolve(dirname, 'package.json')
    const pkg = await readPackageJSON(packageJsonPath)

    const name = pkg.name
    if (name == null) throw new Error(`Missing name in ${packageJsonPath}`)
    visited.set(name, packageJsonPath)

    const deps = [
      ...Object.entries<string>(pkg.dependencies ?? {}),
      //...Object.entries<string>(pkg.devDependencies ?? {}),
      //...Object.entries<string>(pkg.optionalDependencies ?? {}),
      //...Object.entries<string>(pkg.peerDependencies ?? {}),
    ]

    for (const [name, version] of deps) {
      const depDirname = resolve(dirname, 'node_modules', name)
      const depPackageJsonPath = resolve(depDirname, 'package.json')
      if (version.includes('workspace') && !visited.has(name)) {
        const depDirname = resolve(dirname, 'node_modules', name)
        visited.set(name, depPackageJsonPath)
        queue.push(depDirname)
      }
    }
  }

  return Array.from(visited.entries()).map(([name, path]) => ({name, path}))
}

type UserConfigFn = UserConfig | ((env: ConfigEnv) => UserConfig)

export const mergeConfigs = (env: ConfigEnv, config: UserConfigFn, override: UserConfigFn): UserConfig => {
  if (typeof config === 'function') config = config(env)
  if (typeof override === 'function') override = override(env)

  return merge(config, override)
}

export const createTemplateConfig = (dirname: string, overrideConfig: UserConfigFn = {}) => (env: ConfigEnv) => {
  const defaultConfig: UserConfig = {
    build: {
      outDir: 'dist',
      target: 'es2022',
    },
    test: {
      watch: false,
      include: [resolve(dirname, 'src', '__tests__', '**', '*.test.ts?(x)')],
      sequence: {
        hooks: 'stack',
      },
    },
    plugins: [
      tsconfigPaths(),
    ],
  }

  return mergeConfigs(env, defaultConfig, overrideConfig)
}

export const createNodeConfig = (dirname: string, overrideConfig: UserConfigFn = {}) => async (env: ConfigEnv) => {
  const internalPackages = await findInternalPackages(dirname)
  const defaultConfig: UserConfigFn = createTemplateConfig(dirname, {
    build: {
      minify: false,
      sourcemap: true,
      lib: {
        formats: ['es'],
        entry: resolve(dirname, 'src/index'),
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        treeshake: false,
        output: {
          preserveModules: true,
          preserveModulesRoot: `${dirname}/src`,
        },
        external: [
          '.*__generated__.*',
          '.*__tests__.*',
        ],
        plugins: [
          nodeExternals({
            deps: true,
            peerDeps: true,
            devDeps: true,
            optDeps: true,
            packagePath: internalPackages.map((it) => it.path),
            exclude: internalPackages.map((it) => new RegExp(`^${it.name}.*`)),
          }),
        ],
      },
    },
    resolve: {
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      conditions: ['node'],
    },
    plugins: [
      dts({
        exclude: [resolve(dirname, 'src', '__tests__', '**')],
        entryRoot: resolve(dirname, 'src'),
      }),
    ],
  })

  return mergeConfigs(env, defaultConfig, overrideConfig)
}
