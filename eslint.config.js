import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['lib/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A Typert Remote namespace face is declared by extending the interface
      // the generated hex-named class represents (`interface
      // TypertRemoteNamespace$63616e766173 extends CanvasFace {}`) — the name
      // is the wire identity and the body is the shared face, so the empty
      // extension is the idiom, not an accident.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
)
