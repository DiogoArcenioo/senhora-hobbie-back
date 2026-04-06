import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('endereco_usuarios')
export class EnderecoUsuario {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', unique: true })
  usuario_id!: string;

  @Column({ type: 'varchar', length: 180 })
  logradouro!: string;

  @Column({ type: 'varchar', length: 40 })
  numero!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  complemento!: string | null;

  @Column({ type: 'varchar', length: 120 })
  bairro!: string;

  @Column({ type: 'varchar', length: 120 })
  cidade!: string;

  @Column({ type: 'varchar', length: 2 })
  estado!: string;

  @Column({ type: 'varchar', length: 20 })
  cep!: string;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  created_at!: Date;

  @UpdateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  updated_at!: Date;
}
