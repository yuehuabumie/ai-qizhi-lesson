-- Additive private preparation tables. Apply after teaching_agent migration.
-- CreateTable
CREATE TABLE `prep_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `title` VARCHAR(120) NOT NULL DEFAULT '新备课对话',
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `prep_sessions_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_messages` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `runId` VARCHAR(30) NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `attachmentIds` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `prep_messages_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` VARCHAR(30) NOT NULL,
    `runId` VARCHAR(30) NULL,
    `type` VARCHAR(32) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `prep_events_sessionId_id_idx`(`sessionId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_runs` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `messageId` VARCHAR(30) NOT NULL,
    `workerCursor` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
    `error` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `prep_runs_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `prep_runs_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `prep_runs_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `mime` VARCHAR(120) NOT NULL,
    `size` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'upload',
    `storageKey` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    UNIQUE INDEX `prep_attachments_storageKey_key`(`storageKey`),
    INDEX `prep_attachments_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `prep_attachments_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `runId` VARCHAR(30) NOT NULL,
    `callId` VARCHAR(160) NOT NULL,
    `tool` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `version` VARCHAR(64) NOT NULL,
    `preview` LONGTEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `result` LONGTEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),

    INDEX `prep_proposals_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `prep_proposals_runId_status_idx`(`runId`, `status`),
    UNIQUE INDEX `prep_proposals_runId_callId_key`(`runId`, `callId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_skills` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prep_skills_ownerId_name_key`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prep_storage_lock` (
    `id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `prep_sessions` ADD CONSTRAINT `prep_sessions_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_messages` ADD CONSTRAINT `prep_messages_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `prep_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_events` ADD CONSTRAINT `prep_events_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `prep_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_runs` ADD CONSTRAINT `prep_runs_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `prep_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_attachments` ADD CONSTRAINT `prep_attachments_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `prep_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_proposals` ADD CONSTRAINT `prep_proposals_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `prep_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prep_skills` ADD CONSTRAINT `prep_skills_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
