/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { BuilderContext, BuilderOutput, createBuilder } from '@angular-devkit/architect';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BuildOutputFile } from '../../tools/esbuild/bundler-context';
import { buildApplicationInternal } from '../application';
import { Schema as ApplicationBuilderOptions } from '../application/schema';
import { logBuilderStatusWarnings } from './builder-status-warnings';
import { Schema as BrowserBuilderOptions } from './schema';

/**
 * Main execution function for the esbuild-based application builder.
 * The options are compatible with the Webpack-based builder.
 * @param userOptions The browser builder options to use when setting up the application build
 * @param context The Architect builder context object
 * @returns An async iterable with the builder result output
 */
export async function* buildEsbuildBrowser(
  userOptions: BrowserBuilderOptions,
  context: BuilderContext,
  infrastructureSettings?: {
    write?: boolean;
  },
): AsyncIterable<
  BuilderOutput & {
    outputFiles?: BuildOutputFile[];
    assetFiles?: { source: string; destination: string }[];
  }
> {
  // Inform user of status of builder and options
  logBuilderStatusWarnings(userOptions, context);
  const normalizedOptions = normalizeOptions(userOptions);
  const fullOutputPath = path.join(context.workspaceRoot, normalizedOptions.outputPath);

  for await (const result of buildApplicationInternal(normalizedOptions, context, {
    write: false,
  })) {
    if (infrastructureSettings?.write !== false && result.outputFiles) {
      // Write output files
      await writeResultFiles(result.outputFiles, result.assetFiles, fullOutputPath);
    }

    yield result;
  }
}

function normalizeOptions(options: BrowserBuilderOptions): ApplicationBuilderOptions {
  const { main: browser, ngswConfigPath, serviceWorker, polyfills, ...otherOptions } = options;

  return {
    browser,
    serviceWorker: serviceWorker ? ngswConfigPath : false,
    polyfills: typeof polyfills === 'string' ? [polyfills] : polyfills,
    ...otherOptions,
  };
}

// We write the file directly from this builder to maintain webpack output compatibility
// and not output browser files into '/browser'.
async function writeResultFiles(
  outputFiles: BuildOutputFile[],
  assetFiles: { source: string; destination: string }[] | undefined,
  outputPath: string,
) {
  const directoryExists = new Set<string>();
  await Promise.all(
    outputFiles.map(async (file) => {
      // Ensure output subdirectories exist
      const basePath = path.dirname(file.path);
      if (basePath && !directoryExists.has(basePath)) {
        await fs.mkdir(path.join(outputPath, basePath), { recursive: true });
        directoryExists.add(basePath);
      }
      // Write file contents
      await fs.writeFile(path.join(outputPath, file.path), file.contents);
    }),
  );

  if (assetFiles?.length) {
    await Promise.all(
      assetFiles.map(async ({ source, destination }) => {
        // Ensure output subdirectories exist
        const basePath = path.dirname(destination);
        if (basePath && !directoryExists.has(basePath)) {
          await fs.mkdir(path.join(outputPath, basePath), { recursive: true });
          directoryExists.add(basePath);
        }
        // Copy file contents
        await fs.copyFile(source, path.join(outputPath), fsConstants.COPYFILE_FICLONE);
      }),
    );
  }
}

export default createBuilder(buildEsbuildBrowser);
